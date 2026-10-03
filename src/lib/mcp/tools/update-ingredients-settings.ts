import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

const FIELDS = "id, name, unit, min_stock, purchase_pack_qty, purchase_pack_name";
type Row = {
  id: string;
  name: string;
  unit: string;
  min_stock: number | null;
  purchase_pack_qty: number | null;
  purchase_pack_name: string | null;
};

export default defineTool({
  name: "update_ingredients_settings",
  title: "Configurar insumos em lote",
  description:
    "Atualiza em lote (até 200 insumos) o estoque mínimo e a embalagem de compra. purchase_pack_qty = tamanho da embalagem NA UNIDADE DO INSUMO (12 para fardo de 12 latas, 30 para caixa de 30 kg, 10 para múltiplos de 10 kg); purchase_pack_name = nome que aparece na lista ('fardo', 'caixa', 'garrafa 1 L'). Só os campos enviados são alterados; envie null para limpar a embalagem. Confira a unidade com list_ingredients antes. Retorna antes e depois de cada insumo.",
  inputSchema: {
    items: z
      .array(
        z.object({
          ingredient_id: z.string().uuid(),
          min_stock: z.number().nonnegative().optional(),
          purchase_pack_qty: z.number().positive().nullable().optional(),
          purchase_pack_name: z.string().trim().max(60).nullable().optional(),
        }),
      )
      .min(1)
      .max(200),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ items }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);

    // Último valor enviado para cada insumo vence (se o mesmo id vier repetido).
    const patches = new Map<string, Record<string, unknown>>();
    for (const { ingredient_id, ...fields } of items) {
      const patch = patches.get(ingredient_id) ?? {};
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        patch[k] = k === "purchase_pack_name" && v === "" ? null : v;
      }
      patches.set(ingredient_id, patch);
    }
    const ids = Array.from(patches.keys());

    // Valores antes (em blocos, para a URL não ficar grande demais).
    const before = new Map<string, Row>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await supabase.from("ingredients").select(FIELDS).in("id", ids.slice(i, i + 100));
      if (error) return err(error.message);
      for (const r of (data ?? []) as Row[]) before.set(r.id, r);
    }

    // Uma requisição por combinação de valores (não por insumo), para não estourar
    // o limite de requisições do Worker em listas grandes.
    const byPatch = new Map<string, { patch: Record<string, unknown>; ids: string[] }>();
    for (const [id, patch] of patches) {
      if (!before.has(id) || Object.keys(patch).length === 0) continue;
      const key = JSON.stringify(Object.entries(patch).sort());
      const g = byPatch.get(key) ?? { patch, ids: [] };
      g.ids.push(id);
      byPatch.set(key, g);
    }
    const after = new Map<string, Row>();
    for (const { patch, ids: group } of byPatch.values()) {
      for (let i = 0; i < group.length; i += 100) {
        const { data, error } = await supabase
          .from("ingredients")
          .update(patch)
          .in("id", group.slice(i, i + 100))
          .select(FIELDS);
        if (error) return err(error.message);
        for (const r of (data ?? []) as Row[]) after.set(r.id, r);
      }
    }

    const pick = (r: Row) => ({
      min_stock: r.min_stock,
      purchase_pack_qty: r.purchase_pack_qty,
      purchase_pack_name: r.purchase_pack_name,
    });
    const updated = Array.from(after.values()).map((r) => ({
      ingredient_id: r.id,
      name: r.name,
      unit: r.unit,
      before: pick(before.get(r.id)!),
      after: pick(r),
    }));
    const not_found = ids.filter((id) => !before.has(id));
    const unchanged = ids.filter((id) => before.has(id) && !after.has(id));
    return ok({ updated_count: updated.length, updated, not_found, unchanged });
  },
});
