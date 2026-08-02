import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GEMINI_MODEL = "gemini-flash-latest";

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4 },
        }),
      },
    );
  } catch {
    throw new Error("Não foi possível conectar à API do Google. Tente novamente.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[Gemini/insights] ${res.status}: ${body.slice(0, 800)}`);
    if (res.status === 400 && /API key not valid/i.test(body)) {
      throw new Error("Chave da API do Google inválida. Verifique o secret GEMINI_API_KEY.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("Acesso negado pela API do Google. Confira a chave e a API Generative Language habilitada.");
    }
    if (res.status === 429) {
      if (/limit:\s*0/.test(body)) {
        throw new Error(
          "Sua chave do Google está com cota ZERO para este modelo. Ative o faturamento no projeto Google Cloud da chave ou gere uma nova chave no Google AI Studio.",
        );
      }
      throw new Error("Limite de uso do Google atingido. Aguarde alguns segundos e tente de novo.");
    }
    if (res.status === 404) {
      throw new Error("O modelo de IA do Google não está disponível para esta chave. Gere uma nova chave no Google AI Studio.");
    }
    throw new Error(`Falha ao gerar a análise na API do Google (${res.status}).`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    promptFeedback?: { blockReason?: string };
  };
  if (json.promptFeedback?.blockReason) {
    throw new Error("A solicitação foi bloqueada pela API do Google.");
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("A IA não retornou nenhuma análise. Tente novamente.");
  return text;
}

const SalesRowSchema = z.object({
  product_code: z.string().trim().min(1),
  quantity: z.number().nonnegative(),
  unit_price: z.number().nonnegative().nullable().optional(),
});

const CreateReportSchema = z.object({
  reference_month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  file_name: z.string().optional(),
  rows: z.array(SalesRowSchema).min(1),
});

export const createSalesReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateReportSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase.from("profiles").select("restaurant_id").eq("id", userId).maybeSingle();
    if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");

    // Fetch all menu items with codes
    const [{ data: recipes }, { data: products }] = await Promise.all([
      supabase
        .from("recipes")
        .select("id, name, menu_category, current_price, product_code")
        .eq("is_on_menu", true)
        .not("product_code", "is", null),
      (supabase as any)
        .from("menu_products")
        .select("id, name, category, current_price, cost, product_code")
        .not("product_code", "is", null),
    ]);

    // Build code lookup
    type Resolved = {
      source: "recipe" | "menu_product";
      id: string;
      name: string;
      category: string | null;
      price: number;
      cost: number;
    };
    const lookup = new Map<string, Resolved>();

    for (const r of recipes ?? []) {
      const code = String(r.product_code).trim();
      if (!code) continue;
      const { data: uc } = await supabase.rpc("recipe_unit_cost", { _recipe_id: r.id });
      lookup.set(code, {
        source: "recipe",
        id: r.id,
        name: r.name,
        category: r.menu_category,
        price: Number(r.current_price ?? 0),
        cost: Number(uc ?? 0),
      });
    }
    for (const p of (products as any[]) ?? []) {
      const code = String(p.product_code).trim();
      if (!code) continue;
      lookup.set(code, {
        source: "menu_product",
        id: p.id,
        name: p.name,
        category: p.category,
        price: Number(p.current_price ?? 0),
        cost: Number(p.cost ?? 0),
      });
    }

    // Aggregate rows by code (sum quantities, weighted price)
    type Agg = { quantity: number; revenue_with_price: number; qty_with_price: number };
    const agg = new Map<string, Agg>();
    for (const row of data.rows) {
      const code = row.product_code.trim();
      const cur = agg.get(code) ?? { quantity: 0, revenue_with_price: 0, qty_with_price: 0 };
      cur.quantity += row.quantity;
      if (row.unit_price != null && row.unit_price > 0) {
        cur.revenue_with_price += row.unit_price * row.quantity;
        cur.qty_with_price += row.quantity;
      }
      agg.set(code, cur);
    }

    const items: any[] = [];
    const unmapped: { product_code: string; quantity: number }[] = [];
    let total_revenue = 0;
    let total_cost = 0;
    let total_quantity = 0;

    for (const [code, a] of agg) {
      const res = lookup.get(code);
      if (!res) {
        unmapped.push({ product_code: code, quantity: a.quantity });
        continue;
      }
      const unit_price = a.qty_with_price > 0 ? a.revenue_with_price / a.qty_with_price : res.price;
      const unit_cost = res.cost;
      const revenue = unit_price * a.quantity;
      const tcost = unit_cost * a.quantity;
      const margin = revenue - tcost;
      total_revenue += revenue;
      total_cost += tcost;
      total_quantity += a.quantity;
      items.push({
        product_code: code,
        item_name: res.name,
        category: res.category,
        source: res.source,
        recipe_id: res.source === "recipe" ? res.id : null,
        menu_product_id: res.source === "menu_product" ? res.id : null,
        quantity: a.quantity,
        unit_price,
        unit_cost,
        revenue,
        total_cost: tcost,
        margin,
      });
    }

    const { data: report, error: rErr } = await supabase
      .from("sales_reports")
      .insert({
        restaurant_id: prof.restaurant_id,
        reference_month: data.reference_month,
        file_name: data.file_name,
        total_revenue,
        total_cost,
        total_margin: total_revenue - total_cost,
        total_quantity,
        created_by: userId,
      })
      .select("id")
      .single();
    if (rErr || !report) throw new Error(rErr?.message ?? "Erro ao criar relatório");

    if (items.length > 0) {
      const { error } = await supabase.from("sales_report_items").insert(items.map((i) => ({ ...i, report_id: report.id })));
      if (error) throw new Error(error.message);
    }
    if (unmapped.length > 0) {
      const { error } = await supabase.from("sales_report_unmapped").insert(unmapped.map((u) => ({ ...u, report_id: report.id })));
      if (error) throw new Error(error.message);
    }

    return { id: report.id, mapped: items.length, unmapped: unmapped.length };
  });

const InsightsSchema = z.object({ report_id: z.string().uuid() });

export const generateSalesInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InsightsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "Chave da API do Google (GEMINI_API_KEY) não configurada. Adicione o secret nas configurações do projeto.",
      );
    }

    const { data: report, error: rErr } = await supabase
      .from("sales_reports")
      .select("id, reference_month, total_revenue, total_cost, total_margin, total_quantity")
      .eq("id", data.report_id)
      .single();
    if (rErr || !report) throw new Error("Relatório não encontrado");

    const { data: items } = await supabase
      .from("sales_report_items")
      .select("item_name, category, quantity, unit_price, unit_cost, revenue, total_cost, margin")
      .eq("report_id", data.report_id);

    const list = items ?? [];
    const avgQty = list.length > 0 ? list.reduce((s, i) => s + Number(i.quantity), 0) / list.length : 0;
    const avgMarginPct = list.length > 0
      ? list.reduce((s, i) => {
          const r = Number(i.revenue);
          return s + (r > 0 ? (Number(i.margin) / r) * 100 : 0);
        }, 0) / list.length
      : 0;

    function quadrant(i: any) {
      const r = Number(i.revenue);
      const mPct = r > 0 ? (Number(i.margin) / r) * 100 : 0;
      const hi = Number(i.quantity) >= avgQty;
      const ha = mPct >= avgMarginPct;
      if (hi && ha) return "Campeão";
      if (!hi && ha) return "Tesouro escondido";
      if (hi && !ha) return "Queridinho";
      return "Problema";
    }

    const categorized = list.map((i) => ({
      nome: i.item_name,
      categoria: i.category ?? "Sem categoria",
      qtd: Number(i.quantity),
      faturamento: Number(i.revenue),
      cmv_pct: Number(i.revenue) > 0 ? (Number(i.total_cost) / Number(i.revenue)) * 100 : 0,
      margem_pct: Number(i.revenue) > 0 ? (Number(i.margin) / Number(i.revenue)) * 100 : 0,
      quadrante: quadrant(i),
    }));

    const byCat = new Map<string, { revenue: number; cost: number }>();
    for (const i of list) {
      const c = i.category ?? "Sem categoria";
      const e = byCat.get(c) ?? { revenue: 0, cost: 0 };
      e.revenue += Number(i.revenue);
      e.cost += Number(i.total_cost);
      byCat.set(c, e);
    }
    const categorias = Array.from(byCat.entries()).map(([nome, v]) => ({
      nome,
      faturamento: v.revenue,
      cmv_pct: v.revenue > 0 ? (v.cost / v.revenue) * 100 : 0,
    }));

    const payload = {
      mes: report.reference_month,
      faturamento_total: Number(report.total_revenue),
      custo_total: Number(report.total_cost),
      margem_total: Number(report.total_margin),
      cmv_global_pct: Number(report.total_revenue) > 0 ? (Number(report.total_cost) / Number(report.total_revenue)) * 100 : 0,
      categorias,
      itens: categorized,
    };

    const prompt = `Você é um consultor especialista em engenharia de cardápio para restaurantes. Analise os dados de vendas abaixo (em JSON) e gere um parecer em português brasileiro, em markdown, estruturado com seções claras.

Estruture sua resposta com:

## Visão geral
Resumo do desempenho do mês (faturamento, CMV, margem).

## Pontos de atenção
Liste os principais riscos identificados (CMV alto, categorias problemáticas, itens com margem negativa, etc).

## Análise por quadrante
Para cada quadrante (Campeões, Tesouros escondidos, Queridinhos, Problemas), cite até 3 itens e dê uma recomendação específica.

## Recomendações priorizadas
Liste de 3 a 5 ações concretas em ordem de impacto.

Seja direto, prático e use números reais. Não invente dados. Dados:

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\``;

    const text = await callGemini(key, prompt);

    const { error } = await supabase.from("sales_reports").update({ ai_insights: text }).eq("id", data.report_id);
    if (error) throw new Error(error.message);

    return { ai_insights: text };
  });

const DeleteSchema = z.object({ id: z.string().uuid() });

export const deleteSalesReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("sales_reports").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
