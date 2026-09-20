import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyRestaurantId } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2, FolderTree, Plus, ChevronRight, ArrowLeft } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/groups/")({ component: GroupsPage });

function GroupsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingredient_groups").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: members } = useQuery({
    queryKey: ["group-member-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingredient_group_members").select("group_id");
      if (error) throw error;
      return data;
    },
  });

  const counts = new Map<string, number>();
  for (const m of members ?? []) counts.set(m.group_id, (counts.get(m.group_id) ?? 0) + 1);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const restaurantId = await getMyRestaurantId();
    if (!restaurantId) return toast.error("Restaurante não encontrado");
    const { error } = await supabase.from("ingredient_groups").insert({
      restaurant_id: restaurantId, name: name.trim(),
    });
    if (error) return toast.error(error.message);
    setName("");
    toast.success("Grupo criado");
    qc.invalidateQueries({ queryKey: ["groups"] });
  }

  async function removeGroup(id: string) {
    await supabase.from("inventory_items").delete().eq("group_id", id);
    await supabase.from("inventory_groups").delete().eq("group_id", id);
    await supabase.from("ingredient_group_members").delete().eq("group_id", id);
    const { error } = await supabase.from("ingredient_groups").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Grupo excluído");
    qc.invalidateQueries({ queryKey: ["groups"] });
    qc.invalidateQueries({ queryKey: ["group-member-counts"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Button variant="ghost" className="mb-2 -ml-3" asChild>
        <Link to="/inventories">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar ao inventário
        </Link>
      </Button>
      <div className="flex items-center gap-3">
        <FolderTree className="h-6 w-6 text-primary" />
        <div>
          <h1 className="font-display text-3xl">Grupos de insumos</h1>
          <p className="text-sm text-muted-foreground">Organize seus insumos para fazer o inventário por etapas.</p>
        </div>
      </div>

      <form onSubmit={createGroup} className="mt-6 flex gap-2 rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <div className="flex-1">
          <Label htmlFor="gname" className="sr-only">Nome do grupo</Label>
          <Input id="gname" placeholder="Ex: Hortifruti, Carnes, Bebidas..." value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit"><Plus className="mr-2 h-4 w-4" /> Criar</Button>
      </form>

      <div className="mt-6 space-y-3">
        {(groups ?? []).length === 0 ? (
          <p className="rounded-xl border-2 border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
            Nenhum grupo ainda. Crie um para começar.
          </p>
        ) : (
          (groups ?? []).map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
              <Link
                to="/groups/$id"
                params={{ id: g.id }}
                className="flex flex-1 items-center justify-between"
              >
                <div>
                  <h3 className="font-semibold">{g.name}</h3>
                  <p className="text-xs text-muted-foreground">{counts.get(g.id) ?? 0} insumo(s)</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="icon" variant="ghost" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir grupo?</AlertDialogTitle>
                    <AlertDialogDescription>Os insumos não serão removidos, apenas o vínculo ao grupo.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => removeGroup(g.id)} className="bg-destructive text-destructive-foreground">Excluir</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
