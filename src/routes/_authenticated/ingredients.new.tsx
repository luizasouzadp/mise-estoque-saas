import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/ingredients/new")({
  component: NewIngredient,
});

const UNITS = ["un", "kg", "g", "L", "ml", "cx", "pct"];

function NewIngredient() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("un");
  const [category, setCategory] = useState("");
  const [minStock, setMinStock] = useState("0");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!profile?.restaurant_id) {
      setSaving(false);
      toast.error("Restaurante não encontrado.");
      return;
    }
    const { error } = await supabase.from("ingredients").insert({
      restaurant_id: profile.restaurant_id,
      name,
      unit,
      category: category || null,
      min_stock: Number(minStock) || 0,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Insumo cadastrado!");
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    nav({ to: "/ingredients" });
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <Link to="/ingredients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <h1 className="mt-3 font-display text-3xl">Novo insumo</h1>
      <p className="text-sm text-muted-foreground">Adicione um item ao catálogo. O estoque começa em zero — registre uma compra para abastecer.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
        <div>
          <Label htmlFor="name">Nome</Label>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Tomate" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="unit">Unidade</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger id="unit"><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="category">Categoria (opcional)</Label>
            <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Hortifruti" />
          </div>
        </div>
        <div>
          <Label htmlFor="min">Estoque mínimo</Label>
          <Input id="min" type="number" step="0.01" min="0" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">Usado para alertas de reposição.</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => nav({ to: "/ingredients" })}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar insumo"}</Button>
        </div>
      </form>
    </div>
  );
}
