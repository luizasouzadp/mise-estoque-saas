import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, Scale, Upload } from "lucide-react";

export const Route = createFileRoute("/_authenticated/cmv/")({
  component: CmvPage,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayISO() {
  return toLocalISO(new Date());
}
function firstOfMonthISO() {
  const d = new Date();
  return toLocalISO(new Date(d.getFullYear(), d.getMonth(), 1));
}
function parseLocal(s: string, endOfDay = false) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(s);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

function formatBR(s: string) {
  return parseLocal(s).toLocaleDateString("pt-BR");
}

// A stocked preparation is "intermediate" ONLY when every recipe that consumes
// it é, por sua vez, um preparo estocado (ex.: carne picada usada apenas dentro
// da carne cozida). Se o preparo também aparece em qualquer receita que NÃO é
// preparo estocado (ex.: uma pizza do cardápio), suas saídas continuam sendo
// consumo real e não devem ser filtradas.
function computeIntermediatePrepSet(
  ings: Array<{ id: string; source_recipe_id?: string | null }>,
  items: Array<{ recipe_id: string; item_type: string; ingredient_id: string | null; sub_recipe_id: string | null }>,
) {
  const prepIngBySourceRecipe = new Map<string, string>();
  const prepIngIds = new Set<string>();
  const stockedRecipeIds = new Set<string>();
  for (const i of ings as any[]) {
    if (i.source_recipe_id) {
      prepIngBySourceRecipe.set(i.source_recipe_id, i.id);
      prepIngIds.add(i.id);
      stockedRecipeIds.add(i.source_recipe_id);
    }
  }
  const totalUses = new Map<string, number>();
  const stockedUses = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string) =>
    map.set(key, (map.get(key) ?? 0) + 1);

  for (const it of items) {
    let prepIngId: string | null = null;
    if (it.item_type === "ingredient" && it.ingredient_id && prepIngIds.has(it.ingredient_id)) {
      prepIngId = it.ingredient_id;
    } else if (it.item_type === "recipe" && it.sub_recipe_id) {
      prepIngId = prepIngBySourceRecipe.get(it.sub_recipe_id) ?? null;
    }
    if (!prepIngId) continue;
    bump(totalUses, prepIngId);
    if (stockedRecipeIds.has(it.recipe_id)) bump(stockedUses, prepIngId);
  }

  const intermediate = new Set<string>();
  for (const [ingId, total] of totalUses) {
    const stocked = stockedUses.get(ingId) ?? 0;
    if (total > 0 && stocked === total) intermediate.add(ingId);
  }
  return intermediate;
}

type CmvReport = {
  id: string;
  period_start: string;
  period_end: string;
  revenue: number;
  total_cost: number;
  cmv_percent: number;
  theoretical_cost?: number | null;
  theoretical_percent?: number | null;
  sales_data?: Record<string, number> | null;
};

type Product = {
  id: string;
  source: "menu_product" | "recipe";
  name: string;
  category: string | null;
  code: string | null;
  unit_cost: number;
  current_price: number;
};


function CmvPage() {
  const qc = useQueryClient();
  const [from, setFrom] = useState<string>(firstOfMonthISO());
  const [to, setTo] = useState<string>(todayISO());
  const [revenue, setRevenue] = useState<string>("");
  const [compareReport, setCompareReport] = useState<CmvReport | null>(null);

  const { data: restaurant } = useQuery({
    queryKey: ["restaurant-cmv"],
    queryFn: async () => {
      const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
      if (!profile?.restaurant_id) return null;
      const { data } = await supabase.from("restaurants").select("id, ideal_cmv").eq("id", profile.restaurant_id).single();
      return data;
    },
  });

  const { data: ingredients } = useQuery({
    queryKey: ["cmv-ingredients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingredients")
        .select("id, composes_cmv, source_recipe_id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: movements } = useQuery({
    queryKey: ["cmv-movements", from, to],
    queryFn: async () => {
      const startISO = parseLocal(from).toISOString();
      const endISO = parseLocal(to, true).toISOString();
      const { data, error } = await supabase
        .from("stock_movements")
        .select("ingredient_id, quantity, unit_cost, type, notes, occurred_at")
        .eq("type", "out")
        .gte("occurred_at", startISO)
        .lte("occurred_at", endISO);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: ingCosts } = useQuery({
    queryKey: ["cmv-ing-costs"],
    queryFn: async () => {
      const { data } = await supabase.from("ingredients").select("id, avg_cost, last_cost");
      return data ?? [];
    },
  });

  const { data: recipeItemsAll } = useQuery({
    queryKey: ["cmv-recipe-items-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_items")
        .select("recipe_id, item_type, ingredient_id, sub_recipe_id");
      if (error) throw error;
      return data ?? [];
    },
  });


  const totalCost = useMemo(() => {
    if (!movements || !ingredients) return 0;
    const composeSet = new Set(ingredients.filter((i) => i.composes_cmv).map((i) => i.id));
    const prepSet = new Set(
      ingredients.filter((i: any) => i.source_recipe_id).map((i) => i.id),
    );
    const intermediateSet = computeIntermediatePrepSet(
      ingredients as any,
      (recipeItemsAll ?? []) as any,
    );
    const costMap = new Map(
      (ingCosts ?? []).map((i) => [i.id, Number(i.avg_cost ?? 0) || Number(i.last_cost ?? 0) || 0]),
    );
    let total = 0;
    for (const m of movements) {
      if (!composeSet.has(m.ingredient_id)) continue;
      const isProd = (m.notes ?? "").startsWith("production:");
      // Skip production outs of raw ingredients (they re-stock a preparation, avoiding double count).
      if (isProd && !prepSet.has(m.ingredient_id)) continue;
      // Skip intermediate stocked preps (consumed only to produce another stocked prep).
      if (intermediateSet.has(m.ingredient_id)) continue;
      const unitCost = Number(m.unit_cost ?? 0) || (costMap.get(m.ingredient_id) ?? 0);
      total += Number(m.quantity ?? 0) * unitCost;
    }
    return total;
  }, [movements, ingredients, ingCosts, recipeItemsAll]);


  const revenueNum = Number(revenue) || 0;
  const cmvPct = revenueNum > 0 ? (totalCost / revenueNum) * 100 : 0;
  const idealCmv = Number(restaurant?.ideal_cmv ?? 30);

  const { data: reports } = useQuery({
    queryKey: ["cmv-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cmv_reports")
        .select("*")
        .order("period_end", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function save() {
    if (!restaurant?.id) return;
    if (!from || !to) return toast.error("Selecione o período");
    if (!(revenueNum > 0)) return toast.error("Informe o faturamento");
    const { error } = await supabase.from("cmv_reports").insert({
      restaurant_id: restaurant.id,
      period_start: from,
      period_end: to,
      revenue: revenueNum,
      total_cost: totalCost,
      cmv_percent: cmvPct,
    });
    if (error) return toast.error(error.message);
    toast.success("CMV salvo");
    setRevenue("");
    qc.invalidateQueries({ queryKey: ["cmv-reports"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("cmv_reports").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["cmv-reports"] });
  }

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-display text-2xl">CMV</h1>
        <p className="text-sm text-muted-foreground">
          Calcule o CMV de um período: saídas de insumos que compõem o CMV ÷ faturamento.
          Saídas de produção não são contabilizadas.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calcular CMV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label>De</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Até</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Faturamento (R$)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0,00"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={save}>Salvar período</Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Custo (saídas)" value={BRL.format(totalCost)} />
            <Stat label="Faturamento" value={BRL.format(revenueNum)} />
            <Stat
              label="CMV"
              value={revenueNum > 0 ? `${cmvPct.toFixed(2)}%` : "—"}
              highlight={
                revenueNum > 0
                  ? cmvPct > idealCmv
                    ? "bad"
                    : "good"
                  : undefined
              }
              hint={`Ideal: ${idealCmv}%`}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">CMV</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(reports ?? []).map((r) => {
                  const pct = Number(r.cmv_percent);
                  const bad = pct > idealCmv;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        {new Date(r.period_start).toLocaleDateString("pt-BR")} —{" "}
                        {new Date(r.period_end).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-right">{BRL.format(Number(r.total_cost))}</TableCell>
                      <TableCell className="text-right">{BRL.format(Number(r.revenue))}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={bad ? "destructive" : "default"} className={bad ? "" : "bg-emerald-600 hover:bg-emerald-600"}>
                          {pct.toFixed(2)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Comparar com CMV teórico"
                            onClick={() =>
                              setCompareReport({
                                id: r.id,
                                period_start: r.period_start,
                                period_end: r.period_end,
                                revenue: Number(r.revenue),
                                total_cost: Number(r.total_cost),
                                cmv_percent: Number(r.cmv_percent),
                                sales_data: ((r as any).sales_data ?? null) as Record<string, number> | null,
                              })
                            }
                          >

                            <Scale className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(reports ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      Nenhum CMV salvo
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <TheoreticalCompareDialog
        report={compareReport}
        idealCmv={idealCmv}
        onClose={() => setCompareReport(null)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: "good" | "bad";
}) {
  const color =
    highlight === "bad"
      ? "text-destructive"
      : highlight === "good"
        ? "text-emerald-600"
        : "text-foreground";
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-display text-2xl ${color}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function TheoreticalCompareDialog({
  report,
  idealCmv,
  onClose,
}: {
  report: CmvReport | null;
  idealCmv: number;
  onClose: () => void;
}) {
  const open = !!report;
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showIngredientAnalysis, setShowIngredientAnalysis] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQty({});
      setShowIngredientAnalysis(false);
      return;
    }
    const saved = report?.sales_data ?? null;
    if (saved && typeof saved === "object") {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(saved)) next[k] = String(v);
      setQty(next);
    } else {
      setQty({});
    }
    setShowIngredientAnalysis(false);
  }, [open, report?.id]);


  const { data: products } = useQuery<Product[]>({
    queryKey: ["cmv-theoretical-products"],
    enabled: open,
    queryFn: async () => {
      const [mp, rec] = await Promise.all([
        (supabase as any)
          .from("menu_products")
          .select("id, name, category, current_price, cost, product_code")
          .order("name"),
        supabase
          .from("recipes")
          .select("id, name, menu_category, current_price, is_on_menu, product_code")
          .eq("is_on_menu", true)
          .order("name"),
      ]);
      const out: Product[] = [];
      for (const p of mp.data ?? []) {
        out.push({
          id: `mp:${p.id}`,
          source: "menu_product",
          name: p.name,
          category: p.category,
          code: p.product_code ?? null,
          unit_cost: Number(p.cost ?? 0),
          current_price: Number(p.current_price ?? 0),
        });
      }
      const recipeRows = rec.data ?? [];
      const costs = await Promise.all(
        recipeRows.map((r) =>
          supabase.rpc("recipe_unit_cost", { _recipe_id: r.id }).then((res) => Number(res.data ?? 0)),
        ),
      );
      recipeRows.forEach((r, idx) => {
        out.push({
          id: `rec:${r.id}`,
          source: "recipe",
          name: r.name,
          category: r.menu_category,
          code: (r as any).product_code ?? null,
          unit_cost: costs[idx] ?? 0,
          current_price: Number(r.current_price ?? 0),
        });
      });
      return out;
    },
  });

  const { data: recipesExpand } = useQuery({
    queryKey: ["cmv-recipes-expand"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("recipes")
        .select(
          "id, yield_qty, recipe_items!recipe_items_recipe_id_fkey(item_type, ingredient_id, sub_recipe_id, quantity)",
        );
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: menuItemsData } = useQuery({
    queryKey: ["cmv-menu-items"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("menu_products")
        .select("id, items");
      if (error) return [] as Array<{ id: string; items: any[] }>;
      return (data ?? []) as Array<{ id: string; items: any[] }>;
    },
  });

  const { data: ingredientsList } = useQuery({
    queryKey: ["cmv-ing-list"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingredients")
        .select("id, name, unit, avg_cost, last_cost, composes_cmv, source_recipe_id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: periodMovements } = useQuery({
    queryKey: ["cmv-period-movs", report?.period_start, report?.period_end],
    enabled: open && !!report,
    queryFn: async () => {
      const startISO = parseLocal(report!.period_start).toISOString();
      const endISO = parseLocal(report!.period_end, true).toISOString();
      const { data, error } = await supabase
        .from("stock_movements")
        .select("ingredient_id, quantity, type, notes, occurred_at")
        .eq("type", "out")
        .gte("occurred_at", startISO)
        .lte("occurred_at", endISO);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { theoreticalCost, theoreticalRevenue } = useMemo(() => {
    let c = 0;
    let r = 0;
    for (const p of products ?? []) {
      const q = Number(qty[p.id] ?? 0) || 0;
      if (!q) continue;
      c += q * p.unit_cost;
      r += q * p.current_price;
    }
    return { theoreticalCost: c, theoreticalRevenue: r };
  }, [products, qty]);

  const ingredientDiffs = useMemo(() => {
    if (!recipesExpand || !menuItemsData || !ingredientsList) return [];
    const recipeMap = new Map<string, any>((recipesExpand as any[]).map((r) => [r.id, r]));
    const menuMap = new Map<string, any>(menuItemsData.map((m) => [m.id, m]));

    // Map of recipe_id → ingredient_id (for stocked preparations)
    const stockedRecipeToIng = new Map<string, string>();
    const prepIngSet = new Set<string>();
    const cmvIngSet = new Set<string>();
    for (const i of ingredientsList as any[]) {
      if (i.composes_cmv) cmvIngSet.add(i.id);
      if (i.source_recipe_id) {
        prepIngSet.add(i.id);
        stockedRecipeToIng.set(i.source_recipe_id, i.id);
      }
    }

    const theoretical = new Map<string, number>();

    function addRecipe(recipeId: string, mult: number, depth = 0) {
      if (depth > 10 || !mult) return;
      const r = recipeMap.get(recipeId);
      if (!r) return;
      for (const it of (r.recipe_items ?? []) as any[]) {
        const iq = Number(it.quantity ?? 0);
        if (!iq) continue;
        if (it.item_type === "ingredient" && it.ingredient_id) {
          theoretical.set(
            it.ingredient_id,
            (theoretical.get(it.ingredient_id) ?? 0) + mult * iq,
          );
        } else if (it.item_type === "recipe" && it.sub_recipe_id) {
          // If sub-recipe is stocked as an ingredient, count at preparation level
          const stockedIng = stockedRecipeToIng.get(it.sub_recipe_id);
          if (stockedIng) {
            theoretical.set(
              stockedIng,
              (theoretical.get(stockedIng) ?? 0) + mult * iq,
            );
          } else {
            const sub = recipeMap.get(it.sub_recipe_id);
            const y = Number(sub?.yield_qty ?? 1) || 1;
            addRecipe(it.sub_recipe_id, (mult * iq) / y, depth + 1);
          }
        }
      }
    }

    for (const [pid, qStr] of Object.entries(qty)) {
      const q = Number(qStr) || 0;
      if (!q) continue;
      if (pid.startsWith("mp:")) {
        const mp = menuMap.get(pid.slice(3));
        if (!mp) continue;
        for (const it of (mp.items ?? []) as any[]) {
          const iq = Number(it.quantity ?? 0);
          if (!it.ref_id || !iq) continue;
          if (it.ref_type === "ingredient") {
            theoretical.set(it.ref_id, (theoretical.get(it.ref_id) ?? 0) + q * iq);
          } else if (it.ref_type === "recipe") {
            const stockedIng = stockedRecipeToIng.get(it.ref_id);
            if (stockedIng) {
              theoretical.set(stockedIng, (theoretical.get(stockedIng) ?? 0) + q * iq);
            } else {
              const sub = recipeMap.get(it.ref_id);
              const y = Number(sub?.yield_qty ?? 1) || 1;
              addRecipe(it.ref_id, (q * iq) / y);
            }
          }
        }
      } else if (pid.startsWith("rec:")) {
        const rid = pid.slice(4);
        const stockedIng = stockedRecipeToIng.get(rid);
        if (stockedIng) {
          theoretical.set(stockedIng, (theoretical.get(stockedIng) ?? 0) + q);
        } else {
          const sub = recipeMap.get(rid);
          const y = Number(sub?.yield_qty ?? 1) || 1;
          addRecipe(rid, q / y);
        }
      }
    }

    const real = new Map<string, number>();
    const intermediateSet = computeIntermediatePrepSet(
      ingredientsList as any,
      (recipesExpand as any[] ?? []).flatMap((r: any) =>
        (r.recipe_items ?? []).map((it: any) => ({
          recipe_id: r.id,
          item_type: it.item_type,
          ingredient_id: it.ingredient_id ?? null,
          sub_recipe_id: it.sub_recipe_id ?? null,
        })),
      ),
    );
    for (const m of (periodMovements ?? []) as any[]) {
      const isProd = (m.notes ?? "").startsWith("production:");
      // Skip production outs of raw ingredients (they re-stock a preparation).
      // Keep production outs of stocked preparations (real consumption tied to a sale).
      if (isProd && !prepIngSet.has(m.ingredient_id)) continue;
      // Skip intermediate stocked preps (used only to produce another stocked prep).
      if (intermediateSet.has(m.ingredient_id)) continue;
      real.set(m.ingredient_id, (real.get(m.ingredient_id) ?? 0) + Number(m.quantity ?? 0));
    }


    const ingMap = new Map<string, any>((ingredientsList as any[]).map((i) => [i.id, i]));
    const ids = new Set<string>([...theoretical.keys(), ...real.keys()]);
    const rows: Array<{
      id: string;
      name: string;
      unit: string;
      theoretical: number;
      real: number;
      diff: number;
      costDiff: number;
      pctDiff: number | null;
    }> = [];
    for (const id of ids) {
      const ing = ingMap.get(id);
      if (!ing) continue;
      // Exclude non-CMV items (e.g. printer paper, cleaning supplies)
      if (!cmvIngSet.has(id)) continue;
      const t = theoretical.get(id) ?? 0;
      const r = real.get(id) ?? 0;
      const d = r - t;
      const cost = Number(ing.avg_cost ?? 0) || Number(ing.last_cost ?? 0) || 0;
      rows.push({
        id,
        name: ing.name,
        unit: ing.unit,
        theoretical: t,
        real: r,
        diff: d,
        costDiff: d * cost,
        pctDiff: t > 0 ? (d / t) * 100 : null,
      });
    }
    rows.sort((a, b) => Math.abs(b.costDiff) - Math.abs(a.costDiff));
    return rows;
  }, [recipesExpand, menuItemsData, ingredientsList, periodMovements, qty]);

  const realRevenue = Number(report?.revenue ?? 0);
  const theoreticalPct = realRevenue > 0 ? (theoreticalCost / realRevenue) * 100 : 0;
  const realPct = Number(report?.cmv_percent ?? 0);
  const diff = realPct - theoreticalPct;

  async function handleImport(file: File) {
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error("Planilha vazia");
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
      const codeMap = new Map<string, string>();
      for (const p of products ?? []) {
        if (p.code) codeMap.set(p.code.trim().toLowerCase(), p.id);
      }
      let matched = 0;
      let unmatched = 0;
      const next: Record<string, string> = {};
      for (const row of rows) {
        if (!row || row.length < 2) continue;
        const codeRaw = row[0];
        const qtyRaw = row[1];
        if (codeRaw == null || qtyRaw == null) continue;
        const codeKey = String(codeRaw).trim().toLowerCase();
        if (!codeKey) continue;
        const qNum = Number(String(qtyRaw).replace(",", "."));
        if (!Number.isFinite(qNum) || qNum <= 0) continue;
        // Skip likely header row
        if (codeKey === "codigo" || codeKey === "código" || codeKey === "code" || codeKey === "produto") continue;
        const pid = codeMap.get(codeKey);
        if (pid) {
          next[pid] = String((Number(next[pid] ?? 0) || 0) + qNum);
          matched++;
        } else {
          unmatched++;
        }
      }
      setQty((s) => ({ ...s, ...next }));
      if (matched === 0) {
        toast.error("Nenhum código encontrado. Cadastre o código dos produtos no Cardápio.");
      } else {
        toast.success(
          `${matched} produto(s) importado(s)` + (unmatched > 0 ? ` • ${unmatched} código(s) sem correspondência` : ""),
        );
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao ler a planilha");
    }
  }

  async function handleSave() {
    if (!report) return;
    setSaving(true);
    const salesPayload: Record<string, number> = {};
    for (const p of products ?? []) {
      const q = Number(qty[p.id] ?? 0) || 0;
      if (q > 0) salesPayload[p.id] = q;
    }
    const { error } = await supabase
      .from("cmv_reports")
      .update({
        theoretical_cost: theoreticalCost,
        theoretical_percent: theoreticalPct,
        sales_data: salesPayload as any,
      })
      .eq("id", report.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Comparação salva");
    qc.invalidateQueries({ queryKey: ["cmv-reports"] });
    onClose();
  }

  const productsWithoutCode = (products ?? []).filter((p) => !p.code).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Comparar CMV real x teórico</DialogTitle>
        </DialogHeader>

        {report && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                Período:{" "}
                <span className="font-medium text-foreground">
                  {new Date(report.period_start).toLocaleDateString("pt-BR")} —{" "}
                  {new Date(report.period_end).toLocaleDateString("pt-BR")}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImport(f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-1 h-4 w-4" /> Importar do PDV
                </Button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              A planilha deve ter o código do produto na 1ª coluna e a quantidade vendida na 2ª.
              {productsWithoutCode > 0 && (
                <>
                  {" "}
                  <span className="text-destructive">
                    {productsWithoutCode} produto(s) sem código — cadastre na aba Cardápio para que sejam reconhecidos.
                  </span>
                </>
              )}
            </p>

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Código</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Custo unit.</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="w-28 text-right">Vendidos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(products ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">
                        {p.code ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        {p.category && (
                          <div className="text-xs text-muted-foreground">{p.category}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{BRL.format(p.unit_cost)}</TableCell>
                      <TableCell className="text-right">{BRL.format(p.current_price)}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          placeholder="0"
                          value={qty[p.id] ?? ""}
                          onChange={(e) => setQty((s) => ({ ...s, [p.id]: e.target.value }))}
                          className="h-8 text-right"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  {(products ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        Nenhum produto no cardápio
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">CMV real</div>
                <div className="font-display text-2xl">{realPct.toFixed(2)}%</div>
                <div className="text-xs text-muted-foreground">
                  Custo {BRL.format(Number(report.total_cost))} ÷ Faturamento{" "}
                  {BRL.format(realRevenue)}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">CMV teórico</div>
                <div className="font-display text-2xl">
                  {realRevenue > 0 ? `${theoreticalPct.toFixed(2)}%` : "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Custo {BRL.format(theoreticalCost)} ÷ Faturamento {BRL.format(realRevenue)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Faturamento teórico (preço × qtd): {BRL.format(theoreticalRevenue)}
                </div>
              </div>
            </div>

            {realRevenue > 0 && theoreticalCost > 0 && (
              <div
                className={`rounded-lg border p-3 text-sm ${
                  diff > 0 ? "border-destructive/40 text-destructive" : "border-emerald-600/40 text-emerald-700"
                }`}
              >
                Diferença: <strong>{diff > 0 ? "+" : ""}{diff.toFixed(2)} p.p.</strong>{" "}
                {diff > 0
                  ? "— CMV real acima do teórico (possíveis perdas, desperdício ou erro de ficha)."
                  : "— CMV real abaixo do teórico (ótimo aproveitamento ou vendas com custo menor)."}{" "}
                <span className="text-muted-foreground">Ideal: {idealCmv}%.</span>
              </div>
            )}

            {showIngredientAnalysis && (
              <IngredientDiffsTable
                rows={ingredientDiffs}
                hasSales={Object.values(qty).some((v) => Number(v) > 0)}
                loading={!recipesExpand || !ingredientsList || !periodMovements}
              />
            )}
          </div>
        )}


        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="secondary"
            onClick={() => setShowIngredientAnalysis((v) => !v)}
            disabled={!report}
          >
            {showIngredientAnalysis ? "Ocultar análise dos insumos" : "Análise dos insumos utilizados"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !report}>
              {saving ? "Salvando..." : "Salvar comparação"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


const QTY_FMT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

function IngredientDiffsTable({
  rows,
  hasSales,
  loading,
}: {
  rows: Array<{
    id: string;
    name: string;
    unit: string;
    theoretical: number;
    real: number;
    diff: number;
    costDiff: number;
    pctDiff: number | null;
  }>;
  hasSales?: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        Carregando análise dos insumos…
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        {hasSales
          ? "Não há insumos para comparar. Verifique se os produtos vendidos possuem fichas técnicas e se houve movimentações de saída no período."
          : "Preencha as quantidades vendidas acima para gerar a análise dos insumos teóricos x reais."}
      </div>
    );
  }


  const flagged = rows.filter(
    (r) =>
      Math.abs(r.costDiff) >= 1 &&
      (r.pctDiff === null || Math.abs(r.pctDiff) >= 5),
  );
  const totalCostDiff = rows.reduce((s, r) => s + r.costDiff, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium text-sm">Saída real x teórica por insumo</h3>
        <span className="text-xs text-muted-foreground">
          Impacto líquido: <strong className={totalCostDiff > 0 ? "text-destructive" : "text-emerald-700"}>{BRL.format(totalCostDiff)}</strong>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Compara a quantidade que saiu do estoque (movimentações) com o quanto deveria
        ter saído conforme as fichas técnicas dos produtos vendidos. Saídas de produção
        não são consideradas. Diferenças positivas indicam saída acima do esperado
        (possíveis perdas, furtos, erro de ficha ou de contagem).
      </p>
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Insumo</TableHead>
              <TableHead className="text-right">Teórico</TableHead>
              <TableHead className="text-right">Real</TableHead>
              <TableHead className="text-right">Diferença</TableHead>
              <TableHead className="text-right">% </TableHead>
              <TableHead className="text-right">R$ impacto</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const isFlagged =
                Math.abs(r.costDiff) >= 1 &&
                (r.pctDiff === null || Math.abs(r.pctDiff) >= 5);
              const bad = r.diff > 0;
              return (
                <TableRow key={r.id} className={isFlagged ? (bad ? "bg-destructive/5" : "bg-emerald-500/5") : ""}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right">
                    {QTY_FMT.format(r.theoretical)} {r.unit}
                  </TableCell>
                  <TableCell className="text-right">
                    {QTY_FMT.format(r.real)} {r.unit}
                  </TableCell>
                  <TableCell className={`text-right ${bad ? "text-destructive" : r.diff < 0 ? "text-emerald-700" : ""}`}>
                    {r.diff > 0 ? "+" : ""}{QTY_FMT.format(r.diff)} {r.unit}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.pctDiff === null ? "—" : `${r.pctDiff > 0 ? "+" : ""}${r.pctDiff.toFixed(1)}%`}
                  </TableCell>
                  <TableCell className={`text-right ${r.costDiff > 0 ? "text-destructive" : r.costDiff < 0 ? "text-emerald-700" : ""}`}>
                    {r.costDiff > 0 ? "+" : ""}{BRL.format(r.costDiff)}
                  </TableCell>
                  <TableCell className="text-right">
                    {isFlagged && (
                      <Badge variant={bad ? "destructive" : "default"} className={bad ? "" : "bg-emerald-600 hover:bg-emerald-600"}>
                        {bad ? "Furo" : "Sobra"}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {flagged.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {flagged.length} insumo(s) com diferença relevante — verifique fichas técnicas,
          desperdício, perdas ou contagem.
        </div>
      )}
    </div>
  );
}
