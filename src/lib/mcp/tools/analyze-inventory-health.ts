import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";
import { dailyConsumption } from "../lib/consumption";
import { depletionForecast } from "../lib/forecast";

export default defineTool({
  name: "analyze_inventory_health",
  title: "Análise geral de saúde do estoque",
  description:
    "Gera uma análise consolidada do estoque com score (0-100), lista de problemas priorizados e recomendações automáticas.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data: ings, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock, avg_cost, last_cost");
    if (error) return err(error.message);
    const list = ings ?? [];

    const critical: {
      id: string;
      name: string;
      issue: string;
      severity: "alta" | "media" | "baixa";
      details?: Record<string, unknown>;
    }[] = [];

    // Sample forecasts for top-30 by name (avoid too many queries)
    const sample = list.slice(0, 50);
    for (const i of sample) {
      const stock = Number(i.current_stock ?? 0);
      const min = Number(i.min_stock ?? 0);
      if (stock <= 0) {
        critical.push({ id: i.id, name: i.name, issue: "Estoque zerado", severity: "alta" });
        continue;
      }
      if (min > 0 && stock < min) {
        critical.push({
          id: i.id,
          name: i.name,
          issue: "Abaixo do mínimo",
          severity: "media",
          details: { current_stock: stock, min_stock: min },
        });
      }
      const series = await dailyConsumption(supabase, i.id, 30);
      const f = depletionForecast(stock, series, 3);
      if (f.days_remaining != null && f.days_remaining <= 7) {
        critical.push({
          id: i.id,
          name: i.name,
          issue: `Ruptura em ${f.days_remaining} dias (${f.risk})`,
          severity: f.risk === "alto" ? "alta" : "media",
          details: { depletion_date: f.depletion_date, avg_daily: f.avg_daily },
        });
      }
    }

    const totalItems = list.length;
    const problems = critical.length;
    const score = totalItems === 0 ? 0 : Math.max(0, Math.round(100 - (problems / totalItems) * 100));
    const recommendations: string[] = [];
    if (critical.some((c) => c.issue.startsWith("Estoque zerado"))) {
      recommendations.push("Repor imediatamente insumos zerados.");
    }
    if (critical.some((c) => c.issue.startsWith("Ruptura"))) {
      recommendations.push("Gerar pedido de compra para insumos com risco de ruptura.");
    }
    if (critical.some((c) => c.issue === "Abaixo do mínimo")) {
      recommendations.push("Revisar níveis mínimos e planejar reposição.");
    }
    if (recommendations.length === 0) recommendations.push("Nenhuma ação urgente identificada.");

    return ok({
      score,
      total_items_evaluated: sample.length,
      total_items: totalItems,
      critical_issues: critical.sort((a, b) => {
        const ord = { alta: 0, media: 1, baixa: 2 } as const;
        return ord[a.severity] - ord[b.severity];
      }),
      recommendations,
    });
  },
});
