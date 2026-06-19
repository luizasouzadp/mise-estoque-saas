import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { toast } from "sonner";
import { ArrowLeft, Check, ChevronsUpDown, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

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
  const [currentStock, setCurrentStock] = useState("0");
  const [unitValue, setUnitValue] = useState("");
  const [composesCmv, setComposesCmv] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [catOpen, setCatOpen] = useState(false);
  const [catQuery, setCatQuery] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("ingredients").select("category").not("category", "is", null);
      const unique = Array.from(new Set((data ?? []).map((r: any) => (r.category ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"));
      setCategories(unique);
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!profile?.restaurant_id) {
      setSaving(false);
      toast.error("Restaurante não encontrado.");
      return;
    }
    const valueNum = unitValue.trim() === "" ? null : Number(unitValue);
    const { error } = await supabase.from("ingredients").insert({
      restaurant_id: profile.restaurant_id,
      name,
      unit,
      category: category || null,
      min_stock: Number(minStock) || 0,
      current_stock: Number(currentStock) || 0,
      last_cost: valueNum ?? 0,
      avg_cost: valueNum ?? 0,
      composes_cmv: composesCmv,
    }).select("id").single();
    if (error) {
      setSaving(false);
      return toast.error(error.message);
    }
    setSaving(false);
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="current">Estoque atual</Label>
            <Input id="current" type="number" step="0.01" min="0" value={currentStock} onChange={(e) => setCurrentStock(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">Quantidade já disponível hoje.</p>
          </div>
          <div>
            <Label htmlFor="min">Estoque mínimo</Label>
            <Input id="min" type="number" step="0.01" min="0" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">Usado para alertas de reposição.</p>
          </div>
        </div>
        <div>
          <Label htmlFor="value">Valor do item (opcional)</Label>
          <Input id="value" type="number" step="0.01" min="0" value={unitValue} onChange={(e) => setUnitValue(e.target.value)} placeholder="Ex: 12,50" />
          <p className="mt-1 text-xs text-muted-foreground">Preço unitário inicial. Será atualizado a cada compra.</p>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label htmlFor="cmv">Compõe o CMV?</Label>
            <p className="mt-1 text-xs text-muted-foreground">Se ativo, este insumo entra no cálculo do custo de mercadoria vendida.</p>
          </div>
          <Switch id="cmv" checked={composesCmv} onCheckedChange={setComposesCmv} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => nav({ to: "/ingredients" })}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar insumo"}</Button>
        </div>
      </form>
    </div>
  );
}
