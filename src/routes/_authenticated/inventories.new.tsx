import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/inventories/new")({ component: NewInventory });

function NewInventory() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [groupId, setGroupId] = useState<string>("all");
  const [saving, setSaving] = useState(false);

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ingredient_groups").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  async function create() {
    setSaving(true);
    try {
      const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
      const { data: userData } = await supabase.auth.getUser();
      if (!profile?.restaurant_id) throw new Error("Restaurante não encontrado");

      let ingQuery = supabase.from("ingredients")
        .select("id, name, unit, current_stock")
        .eq("restaurant_id", profile.restaurant_id);
      if (groupId !== "all") ingQuery = ingQuery.eq("group_id", groupId);
      const { data: ings, error: ingErr } = await ingQuery;
      if (ingErr) throw ingErr;
      if (!ings || ings.length === 0) throw new Error("Nenhum insumo neste grupo");

      const { data: inv, error: invErr } = await supabase.from("inventories").insert({
        restaurant_id: profile.restaurant_id,
        group_id: groupId === "all" ? null : groupId,
        created_by: userData.user?.id ?? null,
      }).select("id").single();
      if (invErr) throw invErr;

      const { error: itemsErr } = await supabase.from("inventory_items").insert(
        ings.map((i) => ({
          inventory_id: inv.id,
          ingredient_id: i.id,
          ingredient_name: i.name,
          unit: i.unit,
          expected_qty: Number(i.current_stock) || 0,
        })),
      );
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
      <p className="text-sm text-muted-foreground">Escolha o grupo. Geraremos um link para contagem.</p>

      <div className="mt-6 space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
        <div>
          <Label htmlFor="group">Grupo</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger id="group"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os insumos</SelectItem>
              {(groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            <Link to="/groups" className="underline">Gerenciar grupos</Link>
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => nav({ to: "/inventories" })}>Cancelar</Button>
          <Button onClick={create} disabled={saving}>{saving ? "Criando..." : "Criar inventário"}</Button>
        </div>
      </div>
    </div>
  );
}
