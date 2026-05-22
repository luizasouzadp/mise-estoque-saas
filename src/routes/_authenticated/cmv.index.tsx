import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

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

function CmvPage() {
  const qc = useQueryClient();
  const [from, setFrom] = useState<string>(firstOfMonthISO());
  const [to, setTo] = useState<string>(todayISO());
  const [revenue, setRevenue] = useState<string>("");

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

  // Need ingredient avg_cost as fallback for movements without unit_cost
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
      // exclude production-sourced movements
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
                        <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
