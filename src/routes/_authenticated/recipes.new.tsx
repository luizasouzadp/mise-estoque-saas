import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/recipes/new")({
  component: NewRecipe,
});

const UNITS = ["un", "porção", "kg", "g", "L", "ml"];

function NewRecipe() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [yieldQty, setYieldQty] = useState("1");
  const [yieldUnit, setYieldUnit] = useState("un");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!profile?.restaurant_id) {
      setSaving(false);
      return toast.error("Restaurante não encontrado.");
    }
    const { data, error } = await supabase.from("recipes").insert({
      restaurant_id: profile.restaurant_id,
      name,
      description: description || null,
      yield_qty: Number(yieldQty) || 1,
      yield_unit: yieldUnit,
    }).select("id").single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Ficha criada!");
    qc.invalidateQueries({ queryKey: ["recipes"] });
    nav({ to: "/recipes/$id", params: { id: data.id } });
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <Link to="/recipes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <h1 className="mt-3 font-display text-3xl">Nova ficha técnica</h1>
      <p className="text-sm text-muted-foreground">Crie a ficha; em seguida adicione os ingredientes e sub-receitas.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
        <div>
          <Label htmlFor="name">Nome do produto / receita</Label>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Molho de tomate" />
        </div>
        <div>
          <Label htmlFor="desc">Descrição (opcional)</Label>
          <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Modo de preparo, observações..." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="qty">Rendimento</Label>
            <Input id="qty" type="number" step="0.01" min="0.01" required value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="u">Unidade de rendimento</Label>
            <Select value={yieldUnit} onValueChange={setYieldUnit}>
              <SelectTrigger id="u"><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => nav({ to: "/recipes" })}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Criar ficha"}</Button>
        </div>
      </form>
    </div>
  );
}
