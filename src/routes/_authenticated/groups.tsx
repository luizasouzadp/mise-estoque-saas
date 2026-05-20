import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2, FolderTree, Plus } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/groups")({ component: GroupsPage });

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

  const { data: ingredients } = useQuery({
    queryKey: ["ingredients", "with-group"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingredients").select("id, name, unit, group_id").order("name");
      if (error) throw error;
      return data;
    },
  });

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!profile?.restaurant_id) return toast.error("Restaurante não encontrado");
    const { error } = await supabase.from("ingredient_groups").insert({
      restaurant_id: profile.restaurant_id, name: name.trim(),
    });
    if (error) return toast.error(error.message);
    setName("");
    toast.success("Grupo criado");
    qc.invalidateQueries({ queryKey: ["groups"] });
  }

  async function removeGroup(id: string) {
    const { error } = await supabase.from("ingredient_groups").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Grupo excluído");
    qc.invalidateQueries({ queryKey: ["groups"] });
    qc.invalidateQueries({ queryKey: ["ingredients", "with-group"] });
  }

  async function setIngredientGroup(ingredientId: string, groupId: string | null) {
    const { error } = await supabase.from("ingredients").update({ group_id: groupId }).eq("id", ingredientId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["ingredients", "with-group"] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
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
          (groups ?? []).map((g) => {
            const inGroup = (ingredients ?? []).filter((i) => i.group_id === g.id);
            return (
              <div key={g.id} className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{g.name}</h3>
                    <p className="text-xs text-muted-foreground">{inGroup.length} insumo(s)</p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir grupo?</AlertDialogTitle>
                        <AlertDialogDescription>Os insumos ficarão sem grupo.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => removeGroup(g.id)} className="bg-destructive text-destructive-foreground">Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                {inGroup.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {inGroup.map((i) => (
                      <li key={i.id} className="rounded-full bg-secondary px-3 py-1 text-xs">{i.name}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-8">
        <h2 className="font-display text-xl">Atribuir grupo aos insumos</h2>
        <div className="mt-3 divide-y rounded-xl border bg-card shadow-[var(--shadow-soft)]">
          {(ingredients ?? []).map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3 p-3">
              <span className="text-sm">{i.name} <span className="text-xs text-muted-foreground">({i.unit})</span></span>
              <Select value={i.group_id ?? "none"} onValueChange={(v) => setIngredientGroup(i.id, v === "none" ? null : v)}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Sem grupo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem grupo</SelectItem>
                  {(groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
          {(ingredients ?? []).length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">Cadastre insumos primeiro.</p>
          )}
        </div>
      </div>
    </div>
  );
}
