import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/suppliers/")({
  component: SuppliersPage,
});

const DOWS = [
  { v: 0, l: "Dom" }, { v: 1, l: "Seg" }, { v: 2, l: "Ter" }, { v: 3, l: "Qua" },
  { v: 4, l: "Qui" }, { v: 5, l: "Sex" }, { v: 6, l: "Sáb" },
];

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  delivery_days: number[] | null;
  order_days: number[] | null;
  lead_time_days: number | null;
  min_order_value: number | null;
  notes: string | null;
};

function SuppliersPage() {
  const qc = useQueryClient();
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, phone, delivery_days, order_days, lead_time_days, min_order_value, notes")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });
  const [newName, setNewName] = useState("");

  async function addSupplier() {
    const name = newName.trim();
    if (!name) return;
    const { data: prof } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!prof?.restaurant_id) return toast.error("Sessão inválida.");
    const { error } = await supabase.from("suppliers").insert({ restaurant_id: prof.restaurant_id, name });
    if (error) return toast.error(error.message);
    setNewName("");
    toast.success("Fornecedor cadastrado.");
    qc.invalidateQueries({ queryKey: ["suppliers-full"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <h1 className="font-display text-3xl">Fornecedores</h1>
      <p className="text-sm text-muted-foreground">Cadastre a agenda de pedido/entrega para gerar listas de compra por fornecedor.</p>

      <div className="mt-4 flex gap-2">
        <Input placeholder="Nome do fornecedor" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button onClick={addSupplier}><Plus className="mr-1 h-4 w-4" /> Adicionar</Button>
      </div>

      <div className="mt-6 space-y-4">
        {(suppliers ?? []).map((s) => <SupplierCard key={s.id} supplier={s} onChanged={() => qc.invalidateQueries({ queryKey: ["suppliers-full"] })} />)}
        {suppliers?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum fornecedor cadastrado ainda.</p>
        )}
      </div>
    </div>
  );
}

function SupplierCard({ supplier, onChanged }: { supplier: Supplier; onChanged: () => void }) {
  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [orderDays, setOrderDays] = useState<number[]>(supplier.order_days ?? []);
  const [deliveryDays, setDeliveryDays] = useState<number[]>(supplier.delivery_days ?? []);
  const [lead, setLead] = useState(supplier.lead_time_days?.toString() ?? "");
  const [minOrder, setMinOrder] = useState(supplier.min_order_value?.toString() ?? "");
  const [notes, setNotes] = useState(supplier.notes ?? "");
  const [saving, setSaving] = useState(false);

  function toggle(list: number[], v: number, set: (arr: number[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v].sort((a, b) => a - b));
  }

  async function save() {
    setSaving(true);
    const cleanedPhone = phone.replace(/\D/g, "");
    const { error } = await supabase.from("suppliers").update({
      name: name.trim(),
      phone: cleanedPhone || null,
      order_days: orderDays,
      delivery_days: deliveryDays,
      lead_time_days: lead === "" ? null : Number(lead),
      min_order_value: minOrder === "" ? null : Number(minOrder),
      notes: notes.trim() || null,
    }).eq("id", supplier.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Fornecedor atualizado.");
    onChanged();
  }

  async function remove() {
    if (!confirm(`Excluir "${supplier.name}"?`)) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", supplier.id);
    if (error) return toast.error(error.message);
    toast.success("Excluído.");
    onChanged();
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)] space-y-3">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="ghost" size="icon" onClick={remove} aria-label="Excluir"><Trash2 className="h-4 w-4 text-destructive" /></Button>
      </div>
      <div>
        <Label className="text-xs">Telefone / WhatsApp (DDD + número)</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11999998888" inputMode="numeric" />
      </div>
      <div>
        <Label className="text-xs">Dias de pedido</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {DOWS.map((d) => (
            <button key={d.v} type="button" onClick={() => toggle(orderDays, d.v, setOrderDays)}
              className={`rounded-md border px-2 py-1 text-xs ${orderDays.includes(d.v) ? "bg-primary text-primary-foreground" : "bg-background"}`}>
              {d.l}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-xs">Dias de entrega</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {DOWS.map((d) => (
            <button key={d.v} type="button" onClick={() => toggle(deliveryDays, d.v, setDeliveryDays)}
              className={`rounded-md border px-2 py-1 text-xs ${deliveryDays.includes(d.v) ? "bg-primary text-primary-foreground" : "bg-background"}`}>
              {d.l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Prazo de entrega (dias)</Label>
          <Input type="number" min="0" value={lead} onChange={(e) => setLead(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Pedido mínimo (R$)</Label>
          <Input type="number" min="0" step="0.01" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Observações</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: pedir por WhatsApp, contato fulano" />
      </div>
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
      </div>
    </div>
  );
}
