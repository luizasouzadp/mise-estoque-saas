import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { Trash2, Scale } from "lucide-react";

export const Route = createFileRoute("/_authenticated/cmv/")({
  component: CmvPage,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
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
      const { data, error } = await supabase.from("ingredients").select("id, composes_cmv");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: movements } = useQuery({
    queryKey: ["cmv-movements", from, to],
    queryFn: async () => {
      const startISO = new Date(`${from}T00:00:00`).toISOString();
      const endISO = new Date(`${to}T23:59:59.999`).toISOString();
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

  const totalCost = useMemo(() => {
    if (!movements || !ingredients) return 0;
    const composeSet = new Set(ingredients.filter((i) => i.composes_cmv).map((i) => i.id));
    const costMap = new Map(
      (ingCosts ?? []).map((i) => [i.id, Number(i.avg_cost ?? 0) || Number(i.last_cost ?? 0) || 0]),
    );
    let total = 0;
    for (const m of movements) {
      if ((m.notes ?? "").startsWith("production:")) continue;
      if (!composeSet.has(m.ingredient_id)) continue;
      const unitCost = Number(m.unit_cost ?? 0) || (costMap.get(m.ingredient_id) ?? 0);
      total += Number(m.quantity ?? 0) * unitCost;
    }
    return total;
  }, [movements, ingredients, ingCosts]);

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
  const [qty, setQty] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) setQty({});
  }, [open]);

  const { data: products } = useQuery<Product[]>({
    queryKey: ["cmv-theoretical-products"],
    enabled: open,
    queryFn: async () => {
      const [mp, rec] = await Promise.all([
        supabase
          .from("menu_products")
          .select("id, name, category, current_price, cost")
          .order("name"),
        supabase
          .from("recipes")
          .select("id, name, menu_category, current_price, is_on_menu")
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
          unit_cost: Number(p.cost ?? 0),
          current_price: Number(p.current_price ?? 0),
        });
      }
      // Fetch unit cost for each menu recipe via RPC
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
          unit_cost: costs[idx] ?? 0,
          current_price: Number(r.current_price ?? 0),
        });
      });
      return out;
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

  const realRevenue = Number(report?.revenue ?? 0);
  const theoreticalPct = realRevenue > 0 ? (theoreticalCost / realRevenue) * 100 : 0;
  const realPct = Number(report?.cmv_percent ?? 0);
  const diff = realPct - theoreticalPct;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Comparar CMV real x teórico</DialogTitle>
        </DialogHeader>

        {report && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Período:{" "}
              <span className="font-medium text-foreground">
                {new Date(report.period_start).toLocaleDateString("pt-BR")} —{" "}
                {new Date(report.period_end).toLocaleDateString("pt-BR")}
              </span>
            </div>

            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Custo unit.</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="w-32 text-right">Vendidos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(products ?? []).map((p) => (
                    <TableRow key={p.id}>
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
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
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
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
