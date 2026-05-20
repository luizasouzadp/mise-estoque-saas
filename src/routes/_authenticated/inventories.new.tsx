import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/inventories/new")({ component: NewInventory });

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function NewInventory() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [weekday, setWeekday] = useState<string>("1");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ingredient_groups").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function create() {
    if (!name.trim()) return toast.error("Informe um nome para o inventário");
    if (selected.size === 0) return toast.error("Selecione ao menos um grupo");
    setSaving(true);
    try {
      const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
      const { data: userData } = await supabase.auth.getUser();
      if (!profile?.restaurant_id) throw new Error("Restaurante não encontrado");

      const groupIds = Array.from(selected);

      const { data: members, error: mErr } = await supabase
        .from("ingredient_group_members")
        .select("group_id, ingredient_id, ingredients!inner(id, name, unit, current_stock, restaurant_id)")
        .in("group_id", groupIds);
      if (mErr) throw mErr;

      type Ing = { id: string; name: string; unit: string; current_stock: number };
      const byGroup = new Map<string, Ing[]>();
      for (const m of members ?? []) {
        const ing = (m as { ingredients: Ing & { restaurant_id: string } }).ingredients;
        if (!ing || ing.restaurant_id !== profile.restaurant_id) continue;
        if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, []);
        byGroup.get(m.group_id)!.push({ id: ing.id, name: ing.name, unit: ing.unit, current_stock: Number(ing.current_stock) || 0 });
      }
      const empty = groupIds.find((g) => !byGroup.get(g)?.length);
      if (empty) {
        const gn = (groups ?? []).find((g) => g.id === empty)?.name ?? "grupo";
        throw new Error(`O grupo "${gn}" não tem insumos vinculados`);
      }

      const { data: inv, error: invErr } = await supabase.from("inventories").insert({
        restaurant_id: profile.restaurant_id,
        name: name.trim(),
        frequency,
        weekday: frequency === "weekly" ? Number(weekday) : null,
        created_by: userData.user?.id ?? null,
      }).select("id").single();
      if (invErr) throw invErr;

      const { error: gErr } = await supabase.from("inventory_groups").insert(
        groupIds.map((gid) => ({ inventory_id: inv.id, group_id: gid })),
      );
      if (gErr) throw gErr;

      const rows: Array<{ inventory_id: string; ingredient_id: string; ingredient_name: string; unit: string; expected_qty: number; group_id: string }> = [];
      for (const gid of groupIds) {
        for (const i of byGroup.get(gid)!) {
          rows.push({
            inventory_id: inv.id,
            ingredient_id: i.id,
            ingredient_name: i.name,
            unit: i.unit,
            expected_qty: i.current_stock,
            group_id: gid,
          });
        }
      }
      const { error: itemsErr } = await supabase.from("inventory_items").insert(rows);
      if (itemsErr) throw itemsErr;

      toast.success("Inventário criado");
      qc.invalidateQueries({ queryKey: ["inventories"] });
      nav({ to: "/inventories/$id", params: { id: inv.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <Link to="/inventories" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <h1 className="mt-3 font-display text-3xl">Novo inventário</h1>
      <p className="text-sm text-muted-foreground">
        Defina nome, frequência e grupos. Será gerado um único link de contagem para todos os grupos.
      </p>

      <div className="mt-6 space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
        <div className="space-y-2">
          <Label htmlFor="name">Nome do inventário</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Inventário semanal cozinha" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Frequência</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as "daily" | "weekly" | "monthly")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diária</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {frequency === "weekly" && (
            <div className="space-y-2">
              <Label>Dia da semana</Label>
              <Select value={weekday} onValueChange={setWeekday}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((w, i) => <SelectItem key={i} value={String(i)}>{w}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Grupos contados</Label>
          {(groups ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum grupo cadastrado. <Link to="/groups" className="underline">Criar grupos</Link>
            </p>
          ) : (
            <div className="space-y-1">
              {(groups ?? []).map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-muted/50">
                  <Checkbox checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} />
                  <span className="text-sm font-medium">{g.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => nav({ to: "/inventories" })}>Cancelar</Button>
          <Button onClick={create} disabled={saving}>{saving ? "Criando..." : "Criar inventário"}</Button>
        </div>
      </div>
    </div>
  );
}
