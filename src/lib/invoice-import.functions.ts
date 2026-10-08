import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { packFromAlias } from "@/lib/mcp/lib/packs";

// -------- Suggest ingredient matches --------
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigramScore(a: string, b: string): number {
  const grams = (s: string) => {
    const p = `  ${s}  `;
    const set = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((g) => {
    if (B.has(g)) inter++;
  });
  return inter / (A.size + B.size - inter);
}

export const suggestIngredientMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ raw_texts: z.array(z.string()).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: ingredients }, { data: aliases }] = await Promise.all([
      supabase.from("ingredients").select("id, name, unit"),
      supabase.from("ingredient_unit_aliases").select("ingredient_id, from_unit, factor"),
    ]);
    const ings = ingredients ?? [];
    const normTexts = data.raw_texts.map(normalizeText);

    const { data: learned } = await supabase
      .from("purchase_import_matches")
      .select("raw_text_normalized, ingredient_id, hits")
      .in("raw_text_normalized", normTexts.length ? normTexts : [""]);
    const learnedMap = new Map<string, string>();
    (learned ?? []).forEach((l) => learnedMap.set(l.raw_text_normalized, l.ingredient_id));

    const results = data.raw_texts.map((raw, i) => {
      const nkey = normTexts[i];
      if (learnedMap.has(nkey)) {
        const ing = ings.find((g) => g.id === learnedMap.get(nkey));
        if (ing) {
          return {
            raw_text: raw,
            suggestions: [
              {
                ingredient_id: ing.id,
                name: ing.name,
                unit: ing.unit,
                confidence: 1,
                source: "learned" as const,
              },
            ],
          };
        }
      }
      const nraw = normalizeText(raw);
      const scored = ings
        .map((ing) => ({
          ingredient_id: ing.id,
          name: ing.name,
          unit: ing.unit,
          confidence: Number(trigramScore(nraw, normalizeText(ing.name)).toFixed(3)),
          source: "trgm" as const,
        }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3)
        .filter((s) => s.confidence > 0.12);
      return { raw_text: raw, suggestions: scored };
    });

    return {
      matches: results,
      aliases: (aliases ?? []).map((a) => ({
        ingredient_id: a.ingredient_id,
        from_unit: a.from_unit,
        factor: Number(a.factor),
      })),
      ingredients: ings,
    };
  });

// -------- Save imported purchase --------
export const saveImportedPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        supplier_name: z.string().nullable(),
        supplier_tax_id: z.string().nullable(),
        purchased_at: z.string(),
        invoice_image_path: z.string().nullable().optional(),
        invoice_image_paths: z.array(z.string()).nullable().optional(),
        items: z
          .array(
            z.object({
              ingredient_id: z.string().uuid(),
              raw_text: z.string(),
              quantity_nota: z.number().positive(),
              unit_nota: z.string(),
              unit_cost_nota: z.number().nonnegative(),
              factor: z.number().positive(),
              learn_alias: z.boolean().optional(),
            }),
          )
          .min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("restaurant_id")
      .eq("id", userId)
      .maybeSingle();
    const restaurantId = prof?.restaurant_id;
    if (!restaurantId) throw new Error("Restaurante não encontrado");

    // Supplier: find or create by tax_id, then name.
    let supplierName: string | null = null;
    if (data.supplier_tax_id || data.supplier_name) {
      const digits = data.supplier_tax_id?.replace(/\D/g, "") || null;
      let existing: { id: string; name: string } | null = null;
      if (digits) {
        const { data: byTax } = await supabase
          .from("suppliers")
          .select("id, name")
          .eq("tax_id", digits)
          .maybeSingle();
        existing = byTax ?? null;
      }
      if (!existing && data.supplier_name) {
        const { data: byName } = await supabase
          .from("suppliers")
          .select("id, name")
          .ilike("name", data.supplier_name)
          .maybeSingle();
        existing = byName ?? null;
      }
      if (existing) {
        supplierName = existing.name;
        if (digits) {
          await supabase.from("suppliers").update({ tax_id: digits }).eq("id", existing.id);
        }
      } else if (data.supplier_name) {
        const { data: inserted } = await supabase
          .from("suppliers")
          .insert({
            restaurant_id: restaurantId,
            name: data.supplier_name,
            tax_id: digits,
          })
          .select("name")
          .single();
        supplierName = inserted?.name ?? data.supplier_name;
      }
    }

    const paths = data.invoice_image_paths?.length
      ? data.invoice_image_paths
      : data.invoice_image_path
        ? [data.invoice_image_path]
        : [];
    const firstPath = paths[0] ?? null;

    // Insert purchase rows (triggers update stock + last_cost).
    const rows = data.items.map((it) => ({
      restaurant_id: restaurantId,
      ingredient_id: it.ingredient_id,
      quantity: Number((it.quantity_nota * it.factor).toFixed(4)),
      unit_cost:
        it.factor > 0
          ? Number((it.unit_cost_nota / it.factor).toFixed(4))
          : it.unit_cost_nota,
      total_cost: Number((it.quantity_nota * it.unit_cost_nota).toFixed(2)),
      supplier: supplierName,
      purchased_at: data.purchased_at,
      invoice_image_path: firstPath,
      invoice_image_paths: paths.length ? paths : null,
      source: "photo",
      created_by: userId,
    }));

    const { data: insertedPurchases, error } = await supabase
      .from("purchases")
      .insert(rows)
      .select("id");
    if (error) throw new Error(error.message);
    const purchaseIds = (insertedPurchases ?? []).map((r) => r.id as string);

    // Learn aliases (only when user asked to save the conversion).
    const aliasesToLearn = data.items.filter((it) => it.learn_alias);
    if (aliasesToLearn.length) {
      const aliasRows = aliasesToLearn.map((it) => ({
        restaurant_id: restaurantId,
        ingredient_id: it.ingredient_id,
        from_unit: it.unit_nota,
        factor: it.factor,
        created_by: userId,
      }));
      await supabase
        .from("ingredient_unit_aliases")
        .upsert(aliasRows, { onConflict: "ingredient_id,from_unit" });

      // Embalagem memorizada (caixa, fardo…) vira a embalagem de compra do insumo,
      // usada para arredondar a lista de compras. Troca de medida (kg→g) não conta.
      const { data: ingUnits } = await supabase
        .from("ingredients")
        .select("id, unit")
        .in("id", Array.from(new Set(aliasesToLearn.map((it) => it.ingredient_id))));
      const unitById = new Map((ingUnits ?? []).map((i) => [i.id, i.unit as string]));
      const packs = new Map<string, NonNullable<ReturnType<typeof packFromAlias>>>();
      for (const it of aliasesToLearn) {
        const unit = unitById.get(it.ingredient_id);
        const pack = unit ? packFromAlias(it.unit_nota, it.factor, unit) : null;
        if (pack) packs.set(it.ingredient_id, pack);
      }
      for (const [ingredientId, pack] of packs) {
        await supabase.from("ingredients").update(pack).eq("id", ingredientId);
      }
    }

    // Learn text -> ingredient matches: one read + one bulk upsert, since a
    // query per invoice line would exceed the Worker subrequest limit.
    const learned = new Map<string, { ingredient_id: string; hits: number }>();
    const keys = Array.from(
      new Set(data.items.map((it) => normalizeText(it.raw_text)).filter(Boolean)),
    );
    if (keys.length) {
      const { data: existing } = await supabase
        .from("purchase_import_matches")
        .select("raw_text_normalized, hits, ingredient_id")
        .eq("restaurant_id", restaurantId)
        .in("raw_text_normalized", keys);
      for (const e of existing ?? []) {
        learned.set(e.raw_text_normalized, { ingredient_id: e.ingredient_id, hits: e.hits ?? 0 });
      }
    }
    const touched = new Set<string>();
    for (const it of data.items) {
      const nkey = normalizeText(it.raw_text);
      if (!nkey) continue;
      const prev = learned.get(nkey);
      // Same ingredient as learned before: count one more hit; otherwise restart at 1.
      const hits = prev && prev.ingredient_id === it.ingredient_id ? prev.hits + 1 : 1;
      learned.set(nkey, { ingredient_id: it.ingredient_id, hits });
      touched.add(nkey);
    }
    if (touched.size) {
      const now = new Date().toISOString();
      await supabase.from("purchase_import_matches").upsert(
        Array.from(touched, (nkey) => ({
          restaurant_id: restaurantId,
          raw_text_normalized: nkey,
          ingredient_id: learned.get(nkey)!.ingredient_id,
          hits: learned.get(nkey)!.hits,
          last_used_at: now,
        })),
        { onConflict: "restaurant_id,raw_text_normalized" },
      );
    }

    return { ok: true, count: rows.length, purchase_ids: purchaseIds };
  });
