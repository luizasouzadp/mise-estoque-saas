import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/purchases/new")({
  component: NewPurchase,
});

function NewPurchase() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: ingredients } = useQuery({
    queryKey: ["ingredients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ingredients").select("id, name, unit").order("name");
      if (error) throw error;
      return data;
    },
  });

  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [purchasedAt, setPurchasedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const total = useMemo(() => (Number(quantity) || 0) * (Number(unitCost) || 0), [quantity, unitCost]);
  const selected = ingredients?.find((i) => i.id === ingredientId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredientId) return toast.error("Selecione um insumo.");
    setSaving(true);
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    const { data: u } = await supabase.auth.getUser();
    if (!profile?.restaurant_id || !u.user) {
      setSaving(false);
      return toast.error("Sessão inválida.");
    }
    const q = Number(quantity);
    const uc = Number(unitCost);
    const { error } = await supabase.from("purchases").insert({
      restaurant_id: profile.restaurant_id,
      ingredient_id: ingredientId,
      quantity: q,
      unit_cost: uc,
      total_cost: q * uc,
      supplier: supplier || null,
      purchased_at: new Date(purchasedAt).toISOString(),
      created_by: u.user.id,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Compra registrada! Estoque atualizado.");
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    nav({ to: "/purchases" });
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <Link to="/purchases" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <h1 className="mt-3 font-display text-3xl">Nova compra</h1>
      <p className="text-sm text-muted-foreground">Estoque e custo médio são atualizados automaticamente.</p>

      {(!ingredients || ingredients.length === 0) && (
        <div className="mt-6 rounded-xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Cadastre um insumo antes de registrar compras.</p>
          <Button asChild className="mt-3"><Link to="/ingredients/new">Cadastrar insumo</Link></Button>
        </div>
      )}

      {ingredients && ingredients.length > 0 && (
        <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
          <div>
            <Label htmlFor="ing">Insumo</Label>
            <Select value={ingredientId} onValueChange={setIngredientId}>
              <SelectTrigger id="ing"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="qty">Quantidade {selected ? `(${selected.unit})` : ""}</Label>
              <Input id="qty" type="number" step="0.01" min="0" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="uc">Preço unitário (R$)</Label>
              <Input id="uc" type="number" step="0.01" min="0" required value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sup">Fornecedor (opcional)</Label>
              <Input id="sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="dt">Data</Label>
              <Input id="dt" type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-secondary p-4">
            <span className="text-sm text-secondary-foreground">Total</span>
            <span className="font-display text-2xl">R$ {total.toFixed(2)}</span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => nav({ to: "/purchases" })}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Registrar compra"}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
