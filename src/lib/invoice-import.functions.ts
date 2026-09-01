import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// -------- Parse invoice image via Google Gemini (chave própria do usuário) --------
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
  invoice_total: z.number().nullable().optional(),
  items: z.array(ItemSchema),
});

const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PROMPT = `Extraia todos os itens desta nota fiscal brasileira (NFC-e, cupom fiscal ou nota de fornecedor em papel). A nota pode ter várias páginas — considere TODAS as imagens em conjunto como uma única nota.

Retorne JSON estrito no formato:
- supplier: nome/razão social do emitente (string ou null)
- tax_id: CNPJ do emitente (apenas dígitos, sem pontos/barra) ou null
- purchased_at: data de emissão em ISO 8601 (YYYY-MM-DDTHH:mm:ss) ou null
- invoice_total: valor total da nota em R$ (numérico) ou null
- items: array de linhas de produto (de TODAS as páginas), para cada uma:
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
- Números com vírgula na nota devem virar ponto no JSON.
- Não repita itens que aparecem em mais de uma página (por exemplo continuação).`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    supplier: { type: "STRING", nullable: true },
    tax_id: { type: "STRING", nullable: true },
    purchased_at: { type: "STRING", nullable: true },
    invoice_total: { type: "NUMBER", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          raw_text: { type: "STRING" },
          quantity: { type: "NUMBER", nullable: true },
          unit: { type: "STRING", nullable: true },
          unit_price: { type: "NUMBER", nullable: true },
          total: { type: "NUMBER", nullable: true },
        },
        required: ["raw_text"],
      },
    },
  },
  required: ["items"],
} as const;

function dataUrlToInlinePart(url: string) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url.trim());
  if (!match) {
    throw new Error("Formato de imagem inválido. Reenvie a foto da nota.");
  }
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

export const parseInvoiceImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        imageDataUrl: z.string().min(30).optional(),
        imageDataUrls: z.array(z.string().min(30)).min(1).max(10).optional(),
      })
      .refine((v) => v.imageDataUrl || (v.imageDataUrls && v.imageDataUrls.length > 0), {
        message: "Envie ao menos uma imagem.",
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Chave da API do Google (GEMINI_API_KEY) não configurada. Adicione o secret nas configurações do projeto.",
      );
    }

    const urls: string[] = data.imageDataUrls?.length
      ? data.imageDataUrls
      : data.imageDataUrl
        ? [data.imageDataUrl]
        : [];

    const parts = [{ text: PROMPT }, ...urls.map(dataUrlToInlinePart)];

    const requestBody = JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    let res: Response | null = null;
    let lastBody = "";
    // Tenta cada modelo, com retentativas em sobrecarga (429/5xx).
    outer: for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              body: requestBody,
            },
          );
        } catch {
          res = null;
          await sleep(1500 * (attempt + 1));
          continue;
        }
        if (res.ok) break outer;
        lastBody = await res.text().catch(() => "");
        console.error(`[Gemini/${model}] ${res.status}: ${lastBody.slice(0, 500)}`);
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable) break outer;
        if (attempt < 2) await sleep(1500 * (attempt + 1));
      }
    }

    if (!res) {
      throw new Error("Não foi possível conectar à API do Google. Tente novamente.");
    }

    if (!res.ok) {
      const body = lastBody;
      if (res.status >= 500) {
        throw new Error(
          "A IA do Google está sobrecarregada no momento (erro 503). Aguarde alguns instantes e tente ler a nota novamente.",
        );
      }
      if (res.status === 400 && /API key not valid/i.test(body)) {
        throw new Error("Chave da API do Google inválida. Verifique o secret GEMINI_API_KEY.");
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "Acesso negado pela API do Google. Confira se a chave é válida e tem a API Generative Language habilitada.",
        );
      }
      if (res.status === 429) {
        if (/limit:\s*0/.test(body)) {
          throw new Error(
            "Sua chave do Google está com cota ZERO para este modelo (limite gratuito não liberado no projeto Google da chave). Ative o faturamento (billing) no projeto Google Cloud dessa chave ou gere uma nova chave no Google AI Studio em um projeto com nível gratuito habilitado.",
          );
        }
        throw new Error("Limite de uso do Google atingido. Aguarde alguns segundos e tente de novo.");
      }
      if (res.status === 402 || /billing|quota/i.test(body)) {
        throw new Error("Cota/faturamento da sua conta Google impediu a leitura. Verifique no Google AI Studio.");
      }
      if (res.status === 404) {
        throw new Error("O modelo de IA do Google não está disponível para esta chave. Gere uma nova chave no Google AI Studio.");
      }
      throw new Error(`Falha ao ler a nota na API do Google (${res.status}).`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    };

    if (json.promptFeedback?.blockReason) {
      throw new Error("A imagem foi bloqueada pela API do Google. Envie outra foto da nota.");
    }

    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      throw new Error("Não consegui ler a nota. Tente uma foto mais nítida ou reenquadre.");
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end <= start) {
        throw new Error("Não consegui interpretar a nota. Tente uma foto mais nítida.");
      }
      try {
        raw = JSON.parse(text.slice(start, end + 1));
      } catch {
        throw new Error("Não consegui interpretar a nota. Tente uma foto mais nítida.");
      }
    }

    const parsed = ParsedInvoice.safeParse(raw);
    if (!parsed.success) {
      console.error("[Gemini] resposta fora do schema:", parsed.error.message);
      throw new Error("Não consegui ler a nota. Tente uma foto mais nítida ou reenquadre.");
    }
    if (!parsed.data.items.length) {
      throw new Error("Nenhum item foi identificado na nota. Tente uma foto mais nítida.");
    }
    return parsed.data;
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

    return { ok: true, count: rows.length, purchase_ids: purchaseIds };
  });
