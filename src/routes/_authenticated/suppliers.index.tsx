import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyRestaurantId } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PushReminders } from "@/components/PushReminders";
import { toast } from "sonner";
import { Plus, Trash2, Pencil } from "lucide-react";

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
  contact_name: string | null;
  phone: string | null;
  delivery_days: number[] | null;
  order_days: number[] | null;
  lead_time_days: number | null;
  min_order_value: number | null;
  notes: string | null;
  notify_on_order_day: boolean;
};

type SupplierFormValues = {
  name: string;
  contactName: string;
  phone: string;
  orderDays: number[];
  deliveryDays: number[];
  lead: string;
  minOrder: string;
  notes: string;
  notifyOnOrderDay: boolean;
};

const emptySupplierForm: SupplierFormValues = {
  name: "",
  contactName: "",
  phone: "",
  orderDays: [],
  deliveryDays: [],
  lead: "",
  minOrder: "",
  notes: "",
  notifyOnOrderDay: false,
};

function DayToggleGroup({ label, value, onChange }: { label: string; value: number[]; onChange: (arr: number[]) => void }) {
  function toggle(v: number) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v].sort((a, b) => a - b));
  }
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1 flex flex-wrap gap-1">
        {DOWS.map((d) => (
          <button key={d.v} type="button" onClick={() => toggle(d.v)}
            className={`rounded-md border px-2 py-1 text-xs ${value.includes(d.v) ? "bg-primary text-primary-foreground" : "bg-background"}`}>
            {d.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function SupplierFormFields({ values, onChange }: { values: SupplierFormValues; onChange: (values: SupplierFormValues) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Nome do fornecedor</Label>
        <Input value={values.name} onChange={(e) => onChange({ ...values, name: e.target.value })} placeholder="Ex: Distribuidora Central" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Nome do contato</Label>
          <Input value={values.contactName} onChange={(e) => onChange({ ...values, contactName: e.target.value })} placeholder="ex: João" />
        </div>
        <div>
          <Label className="text-xs">Telefone / WhatsApp do contato</Label>
          <Input value={values.phone} onChange={(e) => onChange({ ...values, phone: e.target.value })} placeholder="11999998888" inputMode="numeric" />
        </div>
      </div>
      <div>
        <DayToggleGroup label="Dias de pedido" value={values.orderDays} onChange={(orderDays) => onChange({ ...values, orderDays })} />
        <label className="mt-2 flex items-center gap-2 text-sm">
          <Checkbox checked={values.notifyOnOrderDay} onCheckedChange={(v) => onChange({ ...values, notifyOnOrderDay: !!v })} />
          Notificar no celular/computador no dia do pedido
        </label>
      </div>
      <DayToggleGroup label="Dias de entrega" value={values.deliveryDays} onChange={(deliveryDays) => onChange({ ...values, deliveryDays })} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Prazo de entrega (dias)</Label>
          <Input type="number" min="0" value={values.lead} onChange={(e) => onChange({ ...values, lead: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Pedido mínimo (R$)</Label>
          <Input type="number" min="0" step="0.01" value={values.minOrder} onChange={(e) => onChange({ ...values, minOrder: e.target.value })} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Observações</Label>
        <Textarea rows={2} value={values.notes} onChange={(e) => onChange({ ...values, notes: e.target.value })} placeholder="Ex: pedir por WhatsApp, contato fulano" />
      </div>
    </div>
  );
}

function SuppliersPage() {
  const qc = useQueryClient();
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, contact_name, phone, delivery_days, order_days, lead_time_days, min_order_value, notes, notify_on_order_day")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SupplierFormValues>(emptySupplierForm);
  const [saving, setSaving] = useState(false);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["suppliers-full"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  }

  async function addSupplier() {
    const name = form.name.trim();
    if (!name) return toast.error("Informe o nome do fornecedor.");
    setSaving(true);
    const restaurantId = await getMyRestaurantId();
    if (!restaurantId) {
      setSaving(false);
      return toast.error("Sessão inválida.");
    }
    const cleanedPhone = form.phone.replace(/\D/g, "");
    const { error } = await supabase.from("suppliers").insert({
      restaurant_id: restaurantId,
      name,
      contact_name: form.contactName.trim() || null,
      phone: cleanedPhone || null,
      order_days: form.orderDays,
      delivery_days: form.deliveryDays,
      lead_time_days: form.lead === "" ? null : Number(form.lead),
      min_order_value: form.minOrder === "" ? null : Number(form.minOrder),
      notes: form.notes.trim() || null,
      notify_on_order_day: form.notifyOnOrderDay,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setForm(emptySupplierForm);
    setOpen(false);
    toast.success("Fornecedor cadastrado.");
    refresh();
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <h1 className="font-display text-3xl">Fornecedores</h1>
      <p className="text-sm text-muted-foreground">Cadastre a agenda de pedido/entrega para gerar listas de compra por fornecedor.</p>

      <div className="mt-4">
        <PushReminders />
      </div>

      <div className="mt-4">
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(emptySupplierForm); }}>
          <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> Adicionar Fornecedor</Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo fornecedor</DialogTitle>
            </DialogHeader>
            <SupplierFormFields values={form} onChange={setForm} />
            <DialogFooter>
              <Button onClick={addSupplier} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mt-6 space-y-4">
        {(suppliers ?? []).map((s) => <SupplierCard key={s.id} supplier={s} onChanged={refresh} />)}
        {suppliers?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum fornecedor cadastrado ainda.</p>
        )}
      </div>
    </div>
  );
}

function supplierToFormValues(supplier: Supplier): SupplierFormValues {
  return {
    name: supplier.name,
    contactName: supplier.contact_name ?? "",
    phone: supplier.phone ?? "",
    orderDays: supplier.order_days ?? [],
    deliveryDays: supplier.delivery_days ?? [],
    lead: supplier.lead_time_days?.toString() ?? "",
    minOrder: supplier.min_order_value?.toString() ?? "",
    notes: supplier.notes ?? "",
    notifyOnOrderDay: supplier.notify_on_order_day,
  };
}

function dowLabels(days: number[] | null) {
  if (!days || days.length === 0) return "Não definido";
  return days.map((d) => DOWS.find((dow) => dow.v === d)?.l ?? "").join(", ");
}

function SupplierCard({ supplier, onChanged }: { supplier: Supplier; onChanged: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [values, setValues] = useState<SupplierFormValues>(() => supplierToFormValues(supplier));
  const [saving, setSaving] = useState(false);

  function openEdit() {
    setValues(supplierToFormValues(supplier));
    setEditOpen(true);
  }

  async function save() {
    const name = values.name.trim();
    if (!name) return toast.error("Informe o nome do fornecedor.");
    setSaving(true);
    const cleanedPhone = values.phone.replace(/\D/g, "");
    const { error } = await supabase.from("suppliers").update({
      name,
      contact_name: values.contactName.trim() || null,
      phone: cleanedPhone || null,
      order_days: values.orderDays,
      delivery_days: values.deliveryDays,
      lead_time_days: values.lead === "" ? null : Number(values.lead),
      min_order_value: values.minOrder === "" ? null : Number(values.minOrder),
      notes: values.notes.trim() || null,
      notify_on_order_day: values.notifyOnOrderDay,
    }).eq("id", supplier.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Fornecedor atualizado.");
    setEditOpen(false);
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
    <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-soft)]">
      <div className="bg-[oklch(0.32_0.09_262)] px-4 py-3 text-white">
        <p className="font-display text-lg font-bold leading-tight">{supplier.name}</p>
        {(supplier.contact_name || supplier.phone) && (
          <p className="mt-0.5 text-sm text-white/75">
            {[supplier.contact_name, supplier.phone].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
          <p><span className="text-foreground">Dias de pedido:</span> {dowLabels(supplier.order_days)}</p>
          <p><span className="text-foreground">Dias de entrega:</span> {dowLabels(supplier.delivery_days)}</p>
          <p><span className="text-foreground">Prazo de entrega:</span> {supplier.lead_time_days != null ? `${supplier.lead_time_days} dias` : "Não definido"}</p>
          <p><span className="text-foreground">Pedido mínimo:</span> {supplier.min_order_value != null ? `R$ ${supplier.min_order_value}` : "Não definido"}</p>
        </div>
        {supplier.notes && <p className="text-sm text-muted-foreground">{supplier.notes}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={openEdit}><Pencil className="mr-1 h-4 w-4" /> Editar</Button>
          <Button variant="ghost" size="icon" onClick={remove} aria-label="Excluir"><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar fornecedor</DialogTitle>
          </DialogHeader>
          <SupplierFormFields values={values} onChange={setValues} />
          <DialogFooter>
            <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
