import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/inventories/new")({ component: NewInventory });

function NewInventory() {
  const nav = useNavigate();
  const qc = useQueryClient();
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    if (selected.size === 0) return toast.error("Selecione ao menos um grupo");
    setSaving(true);
    try {
      const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
      const { data: userData } = await supabase.auth.getUser();
      if (!profile?.restaurant_id) throw new Error("Restaurante não encontrado");

      const groupIds = Array.from(selected);

      // Fetch ingredients per group via junction table
      const { data: members, error: mErr } = await supabase
        .from("ingredient_group_members")
        .select("group_id, ingredient_id, ingredients!inner(id, name, unit, current_stock, restaurant_id)")
        .in("group_id", groupIds);
      if (mErr) throw mErr;

      const byGroup = new Map<string, Array<{ id: string; name: string; unit: string; current_stock: number }>>();
      for (const m of members ?? []) {
        const ing = (m as { ingredients: { id: string; name: string; unit: string; current_stock: number; restaurant_id: string } }).ingredients;
        if (!ing || ing.restaurant_id !== profile.restaurant_id) continue;
        if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, []);
        byGroup.get(m.group_id)!.push({ id: ing.id, name: ing.name, unit: ing.unit, current_stock: Number(ing.current_stock) || 0 });
      }
      const emptyGroup = groupIds.find((g) => !byGroup.get(g)?.length);
      if (emptyGroup) {
        const name = (groups ?? []).find((g) => g.id === emptyGroup)?.name ?? "grupo";
        throw new Error(`O grupo "${name}" não tem insumos vinculados`);
      }

      const { data: inv, error: invErr } = await supabase.from("inventories").insert({
        restaurant_id: profile.restaurant_id,
        group_id: null,
        created_by: userData.user?.id ?? null,
      }).select("id").single();
      if (invErr) throw invErr;

      for (const gid of groupIds) {
        const { data: session, error: sErr } = await supabase.from("inventory_sessions").insert({
          inventory_id: inv.id,
          group_id: gid,
        }).select("id").single();
        if (sErr) throw sErr;

        const ings = byGroup.get(gid)!;
        const { error: itemsErr } = await supabase.from("inventory_items").insert(
          ings.map((i) => ({
            inventory_id: inv.id,
            session_id: session.id,
            ingredient_id: i.id,
            ingredient_name: i.name,
            unit: i.unit,
            expected_qty: i.current_stock,
          })),
        );
        if (itemsErr) throw itemsErr;
      }

      toast.success("Inventário criado com sessões por grupo");
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
        Selecione os grupos. Cada grupo gera um link de contagem próprio. Após todas as contagens, finalize o inventário para atualizar o estoque (soma das contagens dos grupos).
      </p>

      <div className="mt-6 space-y-3 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
        {(groups ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum grupo cadastrado. <Link to="/groups" className="underline">Criar grupos</Link>
          </p>
        ) : (
          <div className="space-y-2">
            {(groups ?? []).map((g) => (
              <label key={g.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-muted/50">
                <Checkbox checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} />
                <span className="text-sm font-medium">{g.name}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => nav({ to: "/inventories" })}>Cancelar</Button>
          <Button onClick={create} disabled={saving || selected.size === 0}>
            {saving ? "Criando..." : `Criar (${selected.size} ${selected.size === 1 ? "grupo" : "grupos"})`}
          </Button>
        </div>
      </div>
    </div>
  );
}
