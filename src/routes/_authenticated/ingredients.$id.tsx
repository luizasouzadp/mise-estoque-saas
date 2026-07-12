import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Trash2, TrendingDown, Pencil } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceDot } from "recharts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { normalizeName } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { convertIngredientUnit } from "@/lib/ingredient-unit.functions";

export const Route = createFileRoute("/_authenticated/ingredients/$id")({
  component: IngredientDetail,
});

const UNITS = ["un", "kg", "g", "L", "ml", "cx", "pct"];

function IngredientDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["ingredient", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("ingredients").select("*").eq("id", id).single();
      if (error) throw error;
      const { data: links } = await supabase
        .from("ingredient_group_members")
        .select("group_id")
        .eq("ingredient_id", id);
      return { ...data, groupIds: new Set((links ?? []).map((l) => l.group_id)) };
    },
  });

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await supabase.from("ingredient_groups").select("id, name").order("name")).data ?? [],
  });

  const { data: suppliersList } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id, name").order("name")).data ?? [],
  });

  const [period, setPeriod] = useState<30 | 60 | 90>(30);
  const { data: movements } = useQuery({
    queryKey: ["ingredient_movements", id, period],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - period);
      const { data } = await supabase
        .from("stock_movements")
        .select("type, quantity, occurred_at")
        .eq("ingredient_id", id)
        .gte("occurred_at", since.toISOString())
        .order("occurred_at", { ascending: true });
      return data ?? [];
    },
  });

  const [name, setName] = useState("");
  const [unit, setUnit] = useState("un");
  const [category, setCategory] = useState("");
  const [minStock, setMinStock] = useState("0");
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set());
  const [composesCmv, setComposesCmv] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [unitConvOpen, setUnitConvOpen] = useState(false);
  const [unitConvFactor, setUnitConvFactor] = useState("");
  const [pendingNewUnit, setPendingNewUnit] = useState<string | null>(null);
  const [convertingUnit, setConvertingUnit] = useState(false);
  const convertUnitFn = useServerFn(convertIngredientUnit);



  useEffect(() => {
    if (data) {
      setName(data.name);
      setUnit(data.unit);
      setCategory(data.category ?? "");
      setMinStock(String(data.min_stock));
      setGroupIds(new Set(data.groupIds));
      setComposesCmv(data.composes_cmv ?? true);
    }
  }, [data]);

  function toggleGroup(gid: string) {
    setGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // If unit changed, require explicit conversion via dialog first.
    if (data && unit !== data.unit) {
      setPendingNewUnit(unit);
      setUnitConvFactor("");
      setUnitConvOpen(true);
      return;
    }
    setSaving(true);
    const firstGroup = groupIds.size > 0 ? Array.from(groupIds)[0] : null;
    const { error } = await supabase.from("ingredients").update({
      name: normalizeName(name), category: category || null, min_stock: Number(minStock) || 0, group_id: firstGroup, composes_cmv: composesCmv,
    }).eq("id", id);
    if (error) {
      setSaving(false);
      return toast.error(error.message);
    }
    // Sync junction table
    const existing = data?.groupIds ?? new Set<string>();
    const toAdd = Array.from(groupIds).filter((g) => !existing.has(g));
    const toRemove = Array.from(existing).filter((g) => !groupIds.has(g));
    if (toAdd.length) {
      await supabase.from("ingredient_group_members").insert(
        toAdd.map((gid) => ({ ingredient_id: id, group_id: gid })),
      );
    }
    if (toRemove.length) {
      await supabase.from("ingredient_group_members").delete()
        .eq("ingredient_id", id).in("group_id", toRemove);
    }
    setSaving(false);
    toast.success("Atualizado");
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    qc.invalidateQueries({ queryKey: ["ingredient", id] });
  }

  async function confirmUnitConversion() {
    if (!data || !pendingNewUnit) return;
    const factor = Number(String(unitConvFactor).replace(",", "."));
    if (!isFinite(factor) || factor <= 0) return toast.error("Informe um fator válido (>0)");
    setConvertingUnit(true);
    try {
      await convertUnitFn({ data: { ingredientId: id, newUnit: pendingNewUnit, factor } });
      toast.success("Unidade convertida");
      setUnitConvOpen(false);
      setPendingNewUnit(null);
      qc.invalidateQueries({ queryKey: ["ingredient", id] });
      qc.invalidateQueries({ queryKey: ["ingredients"] });
      qc.invalidateQueries({ queryKey: ["ingredient_movements", id] });
    } catch (err: any) {
      toast.error(err?.message ?? "Erro na conversão");
    } finally {
      setConvertingUnit(false);
    }
  }

  function cancelUnitConversion() {
    if (data) setUnit(data.unit);
    setUnitConvOpen(false);
    setPendingNewUnit(null);
  }

  async function remove() {
    const { error } = await supabase.from("ingredients").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Insumo excluído");
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    nav({ to: "/ingredients" });
  }

  function openAdjust() {
    setAdjustValue(String(Number(data?.current_stock ?? 0)));
    setAdjustNotes("");
    setAdjustOpen(true);
  }

  async function confirmAdjust() {
    const target = Number(String(adjustValue).replace(",", "."));
    if (!isFinite(target) || target < 0) return toast.error("Valor inválido");
    const current = Number(data?.current_stock ?? 0);
    const diff = Number((target - current).toFixed(4));
    if (diff === 0) {
      setAdjustOpen(false);
      return;
    }
    setAdjusting(true);
    const { data: prof } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!prof?.restaurant_id) {
      setAdjusting(false);
      return toast.error("Restaurante não encontrado");
    }
    const { error } = await supabase.from("stock_movements").insert({
      restaurant_id: prof.restaurant_id,
      ingredient_id: id,
      type: diff > 0 ? "in" : "out",
      quantity: Math.abs(diff),
      reason: "Ajuste manual",
      notes: adjustNotes || null,
      occurred_at: new Date().toISOString(),
    });
    setAdjusting(false);
    if (error) return toast.error(error.message);
    toast.success("Estoque ajustado");
    setAdjustOpen(false);
    qc.invalidateQueries({ queryKey: ["ingredient", id] });
    qc.invalidateQueries({ queryKey: ["ingredient_movements", id] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
  }


  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando...</div>;

  // Analytics
  const movs = movements ?? [];
  let totalOut = 0;
  let netDelta = 0;
  for (const m of movs) {
    const q = Number(m.quantity) || 0;
    if (m.type === "out") totalOut += q;
    netDelta += m.type === "in" ? q : -q;
  }
  const weeklyAvg = totalOut * (7 / period);
  const currentStock = Number(data.current_stock) || 0;
  const startStock = currentStock - netDelta;

  // Daily stock series for selected period
  const days: Array<{ date: string; stock: number; label: string; delta: number; absDelta: number }> = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  const dailyDelta = new Map<string, number>();
  for (const m of movs) {
    const d = new Date(m.occurred_at); d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    const q = Number(m.quantity) || 0;
    dailyDelta.set(key, (dailyDelta.get(key) ?? 0) + (m.type === "in" ? q : -q));
  }
  let running = startStock;
  for (let i = period - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * dayMs);
    const key = d.toISOString().slice(0, 10);
    const delta = dailyDelta.get(key) ?? 0;
    running += delta;
    days.push({
      date: key,
      stock: Number(running.toFixed(2)),
      delta: Number(delta.toFixed(2)),
      absDelta: Math.abs(Number(delta.toFixed(2))),
      label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    });
  }
  const maxAbsDelta = days.reduce((m, d) => Math.max(m, d.absDelta), 0);
  const topVariationKeys = new Set(
    days.filter((d) => d.absDelta > 0 && d.absDelta >= maxAbsDelta * 0.8).map((d) => d.date),
  );
  const xInterval = period <= 30 ? 4 : period <= 60 ? 8 : 12;

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <Link to="/ingredients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{data.name}</h1>
          <p className="text-sm text-muted-foreground">Editar dados do insumo.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={openAdjust}
          className="group rounded-lg border bg-card p-3 text-center transition-colors hover:border-primary hover:bg-muted/40"
          title="Ajustar estoque"
        >
          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
            Estoque <Pencil className="h-3 w-3 opacity-60 group-hover:opacity-100" />
          </div>
          <div className="mt-1 font-display text-lg">{currentStock.toFixed(2)} {data.unit}</div>
        </button>
        <Stat label="Custo médio" value={`R$ ${Number(data.avg_cost).toFixed(2)}`} />
        <Stat label="Última compra" value={`R$ ${Number(data.last_cost).toFixed(2)}`} />
      </div>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar estoque</DialogTitle>
            <DialogDescription>
              Informe a quantidade atual em estoque. A diferença gera automaticamente uma movimentação de entrada ou saída.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="adjust-current">Estoque atual ({data.unit})</Label>
              <Input
                id="adjust-current"
                type="number"
                step="0.01"
                min="0"
                value={adjustValue}
                onChange={(e) => setAdjustValue(e.target.value)}
                autoFocus
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Atual: {currentStock.toFixed(2)} {data.unit}
                {adjustValue !== "" && isFinite(Number(String(adjustValue).replace(",", "."))) && (
                  <> · Diferença: {(Number(String(adjustValue).replace(",", ".")) - currentStock).toFixed(2)} {data.unit}</>
                )}
              </p>
            </div>
            <div>
              <Label htmlFor="adjust-notes">Observação (opcional)</Label>
              <Textarea
                id="adjust-notes"
                rows={2}
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                placeholder="Ex.: contagem semanal, perda, quebra..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)} disabled={adjusting}>Cancelar</Button>
            <Button onClick={confirmAdjust} disabled={adjusting}>{adjusting ? "Salvando..." : "Confirmar ajuste"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-4 rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><TrendingDown className="h-4 w-4 text-primary" /> Consumo médio semanal</h2>
            <p className="text-xs text-muted-foreground">Baseado nas saídas dos últimos {period} dias.</p>
          </div>
          <div className="font-display text-2xl">
            {weeklyAvg.toFixed(2)} <span className="text-sm text-muted-foreground">{data.unit}/sem</span>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Variação do estoque ({period} dias)</p>
            <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
              {([30, 60, 90] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 text-xs rounded-sm transition-colors ${period === p ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {p}d
                </button>
              ))}
            </div>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={days} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={xInterval} />
                <YAxis yAxisId="stock" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="delta" orientation="right" tick={{ fontSize: 10 }} hide />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, n: string) => {
                    if (n === "stock") return [`${v} ${data.unit}`, "Estoque"];
                    if (n === "delta") return [`${v} ${data.unit}`, "Variação"];
                    return [v, n];
                  }}
                  labelFormatter={(l) => l}
                />
                <Line yAxisId="stock" type="monotone" dataKey="stock" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line yAxisId="delta" type="monotone" dataKey="delta" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                {days.filter((d) => topVariationKeys.has(d.date)).map((d) => (
                  <ReferenceDot
                    key={d.date}
                    yAxisId="stock"
                    x={d.label}
                    y={d.stock}
                    r={4}
                    fill="hsl(var(--destructive))"
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {maxAbsDelta > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="inline-block h-2 w-2 rounded-full bg-destructive mr-1.5 align-middle" />
              Dias destacados: maior variação do período.
            </p>
          )}
        </div>
      </div>


      <form onSubmit={save} className="mt-6 space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
        <div>
          <Label htmlFor="name">Nome</Label>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="unit">Unidade</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger id="unit"><SelectValue /></SelectTrigger>
              <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="category">Categoria</Label>
            <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="min">Estoque mínimo</Label>
          <Input id="min" type="number" step="0.01" min="0" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label htmlFor="cmv">Compõe o CMV?</Label>
            <p className="mt-1 text-xs text-muted-foreground">Se ativo, este insumo entra no cálculo do CMV.</p>
          </div>
          <Switch id="cmv" checked={composesCmv} onCheckedChange={setComposesCmv} />
        </div>
        <div>
          <Label>Grupos de contagem</Label>
          <p className="text-xs text-muted-foreground">O insumo pode pertencer a vários grupos. As contagens serão somadas no inventário.</p>
          {(groups ?? []).length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Nenhum grupo cadastrado.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {(groups ?? []).map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-2 hover:bg-muted/50">
                  <Checkbox checked={groupIds.has(g.id)} onCheckedChange={() => toggleGroup(g.id)} />
                  <span className="text-sm">{g.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between pt-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" /> Excluir
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir insumo?</AlertDialogTitle>
                <AlertDialogDescription>Esta ação remove o insumo e seu histórico de compras. Não pode ser desfeita.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </div>
      </form>

      <Dialog open={unitConvOpen} onOpenChange={(o) => { if (!o) cancelUnitConversion(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Converter unidade</DialogTitle>
            <DialogDescription>
              Informe o fator de conversão para que estoque, compras, movimentações,
              fichas técnicas e inventários sejam atualizados automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div>1 <strong>{data?.unit}</strong> equivale a quantos <strong>{pendingNewUnit}</strong>?</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Ex.: trocando de <em>cx</em> para <em>un</em>, se 1 cx = 12 un, digite 12.
                Quantidades serão multiplicadas e custos unitários divididos pelo fator.
              </p>
            </div>
            <div>
              <Label htmlFor="conv-factor">Fator (1 {data?.unit} = ? {pendingNewUnit})</Label>
              <Input
                id="conv-factor"
                inputMode="decimal"
                value={unitConvFactor}
                onChange={(e) => setUnitConvFactor(e.target.value)}
                placeholder="Ex: 12 ou 0,5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={cancelUnitConversion} disabled={convertingUnit}>Cancelar</Button>
            <Button onClick={confirmUnitConversion} disabled={convertingUnit}>
              {convertingUnit ? "Convertendo..." : "Converter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-lg">{value}</div>
    </div>
  );
}
