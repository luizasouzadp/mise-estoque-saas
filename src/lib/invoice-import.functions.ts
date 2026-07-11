import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

// -------- Parse invoice image via Gemini vision --------
const ItemSchema = z.object({
  raw_text: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  unit_price: z.number().nullable(),
  total: z.number().nullable(),
});
const ParsedInvoice = z.object({
  supplier: z.string().nullable(),
  tax_id: z.string().nullable(),
  purchased_at: z.string().nullable(),
  items: z.array(ItemSchema),
});

export const parseInvoiceImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ imageDataUrl: z.string().min(30) }).parse(input),
  )
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY não configurada");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-pro");
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: ParsedInvoice }),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extraia todos os itens desta nota fiscal brasileira (NFC-e, cupom fiscal ou nota de fornecedor em papel).

Retorne JSON estrito no formato:
- supplier: nome/razão social do emitente (string ou null)
- tax_id: CNPJ do emitente (apenas dígitos, sem pontos/barra) ou null
- purchased_at: data de emissão em ISO 8601 (YYYY-MM-DDTHH:mm:ss) ou null
- items: array de linhas de produto, para cada uma:
  - raw_text: descrição EXATA como aparece na nota (inclua marca, tamanho, embalagem)
  - quantity: quantidade numérica (use ponto decimal)
  - unit: unidade como aparece (un, UN, KG, kg, L, LT, ML, PT, PCT, CX, FD, DZ, etc.)
  - unit_price: preço unitário em R$ (numérico, ponto decimal)
  - total: subtotal da linha em R$ (numérico)

Regras:
- Não invente linhas. Só retorne o que estiver visível.
- Ignore linhas de desconto, subtotal geral, frete, tributos.
- Se a nota mostrar "2 x 3,50 = 7,00", quantity=2, unit_price=3.50, total=7.00.
- Se unidade não aparecer, use "un".
- Números com vírgula na nota devem virar ponto no JSON.`,
              },
              { type: "image", image: data.imageDataUrl },
            ],
          },
        ],
      });
      return output;
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) {
        throw new Error(
          "Não consegui ler a nota. Tente uma foto mais nítida ou reenquadre.",
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("429")) throw new Error("Muitas leituras em sequência. Aguarde alguns segundos.");
      if (msg.includes("402")) throw new Error("Créditos de IA esgotados. Recarregue em Configurações.");
      throw e;
    }
  });

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
        invoice_image_path: z.string().nullable(),
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
      invoice_image_path: data.invoice_image_path,
      source: "photo",
      created_by: userId,
    }));
    const { error } = await supabase.from("purchases").insert(rows);
    if (error) throw new Error(error.message);

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
    }

    // Learn text -> ingredient matches.
    for (const it of data.items) {
      const nkey = normalizeText(it.raw_text);
      if (!nkey) continue;
      const { data: existing } = await supabase
        .from("purchase_import_matches")
        .select("id, hits, ingredient_id")
        .eq("raw_text_normalized", nkey)
        .maybeSingle();
      if (existing && existing.ingredient_id === it.ingredient_id) {
        await supabase
          .from("purchase_import_matches")
          .update({ hits: (existing.hits ?? 0) + 1, last_used_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        if (existing) {
          await supabase.from("purchase_import_matches").delete().eq("id", existing.id);
        }
        await supabase.from("purchase_import_matches").insert({
          restaurant_id: restaurantId,
          raw_text_normalized: nkey,
          ingredient_id: it.ingredient_id,
          hits: 1,
        });
      }
    }

    return { ok: true, count: rows.length };
  });
