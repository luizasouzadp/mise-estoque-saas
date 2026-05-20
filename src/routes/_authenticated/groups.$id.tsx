import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeft, Save, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/groups/$id")({ component: GroupDetail });

function GroupDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["group-detail", id],
    queryFn: async () => {
      const [{ data: g }, { data: ings }, { data: mem }] = await Promise.all([
        supabase.from("ingredient_groups").select("id, name").eq("id", id).maybeSingle(),
        supabase.from("ingredients").select("id, name, unit, category").order("name"),
        supabase.from("ingredient_group_members").select("ingredient_id").eq("group_id", id),
      ]);
      return { group: g, ingredients: ings ?? [], memberIds: (mem ?? []).map((m) => m.ingredient_id) };
    },
  });

  useEffect(() => {
    if (data?.memberIds) setSelected(new Set(data.memberIds));
  }, [data?.memberIds]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return data?.ingredients ?? [];
    return (data?.ingredients ?? []).filter((i) => i.name.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q));
  }, [data?.ingredients, filter]);

  function toggle(idg: string) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(idg)) n.delete(idg); else n.add(idg);
      return n;
    });
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const current = new Set(data.memberIds);
      const toAdd = [...selected].filter((x) => !current.has(x));
      const toRemove = [...current].filter((x) => !selected.has(x));
      if (toAdd.length) {
        const { error } = await supabase.from("ingredient_group_members")
          .insert(toAdd.map((ingredient_id) => ({ ingredient_id, group_id: id })));
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await supabase.from("ingredient_group_members")
          .delete().eq("group_id", id).in("ingredient_id", toRemove);
        if (error) throw error;
      }

      // Sync inventory_items for every inventory that uses this group
      const { data: invGroups } = await supabase
        .from("inventory_groups").select("inventory_id").eq("group_id", id);
      const invIds = (invGroups ?? []).map((r) => r.inventory_id);
      if (invIds.length) {
        if (toRemove.length) {
          await supabase.from("inventory_items").delete()
            .eq("group_id", id).in("inventory_id", invIds).in("ingredient_id", toRemove);
        }
        if (toAdd.length) {
          const { data: ings } = await supabase
            .from("ingredients").select("id, name, unit, current_stock").in("id", toAdd);
          const rows: Array<{ inventory_id: string; ingredient_id: string; ingredient_name: string; unit: string; expected_qty: number; group_id: string }> = [];
          for (const inv of invIds) {
            for (const ing of ings ?? []) {
              rows.push({
                inventory_id: inv,
                ingredient_id: ing.id,
                ingredient_name: ing.name,
                unit: ing.unit,
                expected_qty: Number(ing.current_stock) || 0,
                group_id: id,
              });
            }
          }
          if (rows.length) await supabase.from("inventory_items").insert(rows);
        }
      }

      toast.success("Grupo atualizado");
      qc.invalidateQueries({ queryKey: ["group-detail", id] });
      qc.invalidateQueries({ queryKey: ["group-member-counts"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      nav({ to: "/groups" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando...</div>;
  if (!data.group) return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="font-display text-2xl">Grupo não encontrado</h1>
      <Link to="/groups" className="text-sm underline">Voltar</Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link to="/groups" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{data.group.name}</h1>
          <p className="text-sm text-muted-foreground">Selecione os insumos que pertencem a este grupo. Edite quando quiser.</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Selecionados</div>
          <div className="font-display text-2xl">{selected.size}</div>
        </div>
      </div>

      <div className="mt-4 relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar insumo..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>

      <div className="mt-4 divide-y rounded-xl border bg-card shadow-[var(--shadow-soft)]">
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nenhum insumo encontrado.</p>
        ) : filtered.map((i) => (
          <label key={i.id} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/40">
            <Checkbox checked={selected.has(i.id)} onCheckedChange={() => toggle(i.id)} />
            <div className="flex-1">
              <div className="text-sm font-medium">{i.name}</div>
              <div className="text-xs text-muted-foreground">{i.unit}{i.category ? ` · ${i.category}` : ""}</div>
            </div>
          </label>
        ))}
      </div>

      <div className="sticky bottom-4 mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => nav({ to: "/groups" })}>Cancelar</Button>
        <Button onClick={save} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? "Salvando..." : "Salvar"}</Button>
      </div>
    </div>
  );
}
