import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Trash2, TrendingDown } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
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

  const { data: movements } = useQuery({
    queryKey: ["ingredient_movements", id],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setName(data.name);
      setUnit(data.unit);
      setCategory(data.category ?? "");
      setMinStock(String(data.min_stock));
      setGroupIds(new Set(data.groupIds));
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
    setSaving(true);
    const firstGroup = groupIds.size > 0 ? Array.from(groupIds)[0] : null;
    const { error } = await supabase.from("ingredients").update({
      name, unit, category: category || null, min_stock: Number(minStock) || 0, group_id: firstGroup,
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

  async function remove() {
    const { error } = await supabase.from("ingredients").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Insumo excluído");
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    nav({ to: "/ingredients" });
  }

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando...</div>;

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
        <Stat label="Estoque" value={`${Number(data.current_stock).toFixed(2)} ${data.unit}`} />
        <Stat label="Custo médio" value={`R$ ${Number(data.avg_cost).toFixed(2)}`} />
        <Stat label="Última compra" value={`R$ ${Number(data.last_cost).toFixed(2)}`} />
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
