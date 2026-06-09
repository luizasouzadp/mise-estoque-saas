import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { finalizeInventory } from "@/lib/inventory.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Copy, MessageCircle, CheckCircle2, Trash2, CheckCheck, Pencil, Save, X, Plus, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/inventories/$id")({ component: InventoryDetail });

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function freqLabel(f: string) {
  return f === "daily" ? "Diária" : f === "monthly" ? "Mensal" : "Semanal";
}

function statusInfo(frequency: string, last: string | null): { label: string; tone: "ok" | "late" | "new" } {
  if (!last) return { label: "Aguardando primeira contagem", tone: "new" };
  const lastMs = new Date(last).getTime();
  const days = (Date.now() - lastMs) / (1000 * 60 * 60 * 24);
  const limit = frequency === "daily" ? 1 : frequency === "monthly" ? 30 : 7;
  return days > limit
    ? { label: `Atrasado (${Math.floor(days)}d)`, tone: "late" }
    : { label: `Em dia`, tone: "ok" };
}

function InventoryDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const finalize = useServerFn(finalizeInventory);
  const [finalizing, setFinalizing] = useState(false);
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contactDialog, setContactDialog] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState("");

  const { data: contacts } = useQuery({
    queryKey: ["whatsapp_contacts"],
    queryFn: async () => {
      const { data } = await supabase.from("whatsapp_contacts").select("id, name, phone").order("name");
      return data ?? [];
    },
  });

  // edit state
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [weekday, setWeekday] = useState<string>("1");
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["inventory", id],
    queryFn: async () => {
      const { data: inv, error } = await supabase
        .from("inventories")
        .select("id, name, status, created_at, last_completed_at, frequency, weekday, time_of_day, public_token, restaurant_id")
        .eq("id", id).single();
      if (error) throw error;

      const { data: items } = await supabase
        .from("inventory_items")
        .select("id, ingredient_id, ingredient_name, unit, expected_qty, counted_qty, group_id")
        .eq("inventory_id", id)
        .order("ingredient_name");

      const { data: invGroups } = await supabase
        .from("inventory_groups").select("group_id").eq("inventory_id", id);
      const gIds = (invGroups ?? []).map((g) => g.group_id);
      const { data: groups } = gIds.length
        ? await supabase.from("ingredient_groups").select("id, name").in("id", gIds)
        : { data: [] };

      const { data: allGroups } = await supabase
        .from("ingredient_groups").select("id, name").order("name");

      return { inv, items: items ?? [], groups: groups ?? [], allGroups: allGroups ?? [], groupIds: gIds };
    },
  });

  useEffect(() => {
    if (!data) return;
    setName(data.inv.name ?? "");
    setFrequency(data.inv.frequency as "daily" | "weekly" | "monthly");
    setWeekday(String(data.inv.weekday ?? 1));
    setTimeOfDay(((data.inv.time_of_day as string) ?? "09:00:00").slice(0, 5));
    setSelectedGroups(new Set(data.groupIds));
  }, [data]);

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando...</div>;

  const totals = new Map<string, { name: string; unit: string; total: number; counted: boolean }>();
  for (const it of data.items) {
    const prev = totals.get(it.ingredient_id) ?? { name: it.ingredient_name, unit: it.unit, total: 0, counted: false };
    if (it.counted_qty != null) {
      prev.total += Number(it.counted_qty);
      prev.counted = true;
    }
    totals.set(it.ingredient_id, prev);
  }
  const totalsArr = Array.from(totals.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const anyCounted = totalsArr.some(([, t]) => t.counted);

  const st = statusInfo(data.inv.frequency, data.inv.last_completed_at);
  const link = typeof window !== "undefined" ? `${window.location.origin}/count/${data.inv.public_token}` : "";
  const message = `Olá! Hora da contagem: ${data.inv.name ?? "Inventário"}. Link: ${link}`;
  const cleanPhone = phone.replace(/\D/g, "");
  const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  const timeLabel = ((data.inv.time_of_day as string) ?? "").slice(0, 5);

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    toast.success("Link copiado");
  }

  async function remove() {
    if (!confirm("Excluir este inventário? Esta ação não pode ser desfeita.")) return;
    const { error } = await supabase.from("inventories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Inventário excluído");
    qc.invalidateQueries({ queryKey: ["inventories"] });
    nav({ to: "/inventories" });
  }

  function toggleGroup(gid: string) {
    setSelectedGroups((p) => {
      const n = new Set(p);
      if (n.has(gid)) n.delete(gid); else n.add(gid);
      return n;
    });
  }

  async function saveEdit() {
    if (!data) return;
    if (!name.trim()) return toast.error("Informe um nome");
    if (selectedGroups.size === 0) return toast.error("Selecione ao menos um grupo");
    setSaving(true);
    try {
      const { error: uErr } = await supabase.from("inventories").update({
        name: name.trim(),
        frequency,
        weekday: frequency === "weekly" ? Number(weekday) : null,
        time_of_day: `${timeOfDay}:00`,
      }).eq("id", id);
      if (uErr) throw uErr;

      const current = new Set(data.groupIds);
      const toAdd = [...selectedGroups].filter((x) => !current.has(x));
      const toRemove = [...current].filter((x) => !selectedGroups.has(x));

      if (toRemove.length) {
        await supabase.from("inventory_groups").delete()
          .eq("inventory_id", id).in("group_id", toRemove);
        await supabase.from("inventory_items").delete()
          .eq("inventory_id", id).in("group_id", toRemove);
      }
      if (toAdd.length) {
        await supabase.from("inventory_groups").insert(
          toAdd.map((gid) => ({ inventory_id: id, group_id: gid })),
        );
        const { data: members } = await supabase
          .from("ingredient_group_members")
          .select("group_id, ingredient_id, ingredients!inner(id, name, unit, current_stock, restaurant_id)")
          .in("group_id", toAdd);
        type Ing = { id: string; name: string; unit: string; current_stock: number; restaurant_id: string };
        const rows: Array<{ inventory_id: string; ingredient_id: string; ingredient_name: string; unit: string; expected_qty: number; group_id: string }> = [];
        for (const m of members ?? []) {
          const ing = (m as { ingredients: Ing }).ingredients;
          if (!ing || ing.restaurant_id !== data.inv.restaurant_id) continue;
          rows.push({
            inventory_id: id,
            ingredient_id: ing.id,
            ingredient_name: ing.name,
            unit: ing.unit,
            expected_qty: Number(ing.current_stock) || 0,
            group_id: m.group_id,
          });
        }
        if (rows.length) await supabase.from("inventory_items").insert(rows);
      }

      toast.success("Inventário atualizado");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["inventory", id] });
      qc.invalidateQueries({ queryKey: ["inventories"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function addContact() {
    if (!data) return;
    const cleaned = newContactPhone.replace(/\D/g, "");
    if (!newContactName.trim() || cleaned.length < 10) return toast.error("Informe nome e telefone válido");
    const { error } = await supabase.from("whatsapp_contacts").insert({
      restaurant_id: data.inv.restaurant_id, name: newContactName.trim(), phone: cleaned,
    });
    if (error) return toast.error(error.message);
    setNewContactName(""); setNewContactPhone("");
    qc.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
    toast.success("Contato salvo");
  }

  async function deleteContact(cid: string) {
    const { error } = await supabase.from("whatsapp_contacts").delete().eq("id", cid);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
  }

  async function handleFinalize() {
    setFinalizing(true);
    try {
      await finalize({ data: { inventoryId: id } });
      toast.success("Contagem finalizada e estoque atualizado");
      qc.invalidateQueries({ queryKey: ["inventory", id] });
      qc.invalidateQueries({ queryKey: ["inventories"] });
      qc.invalidateQueries({ queryKey: ["ingredients"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao finalizar");
    } finally {
      setFinalizing(false);
    }
  }

  async function saveItemQty(itemId: string) {
    const val = parseFloat(editingQty.replace(",", "."));
    if (isNaN(val) || val < 0) {
      toast.error("Informe uma quantidade válida");
      return;
    }
    const { error } = await supabase
      .from("inventory_items")
      .update({ counted_qty: val })
      .eq("id", itemId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Quantidade atualizada");
    setEditingItemId(null);
    setEditingQty("");
    qc.invalidateQueries({ queryKey: ["inventory", id] });
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link to="/inventories" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{data.inv.name ?? "Inventário"}</h1>
          <p className="text-sm text-muted-foreground">
            {freqLabel(data.inv.frequency)}
            {data.inv.frequency === "weekly" && data.inv.weekday != null && <> · {WEEKDAYS[data.inv.weekday]}</>}
            {timeLabel && <> · {timeLabel}</>}
            {data.inv.last_completed_at && <> · última contagem em {new Date(data.inv.last_completed_at).toLocaleDateString("pt-BR")}</>}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${
          st.tone === "ok" ? "bg-primary/15 text-primary" :
          st.tone === "late" ? "bg-destructive/15 text-destructive" :
          "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]"
        }`}>{st.label}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {data.groups.map((g) => (
          <span key={g.id} className="rounded-full bg-muted px-3 py-1 text-xs">{g.name}</span>
        ))}
        {!editing && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setEditing(true)}>
            <Pencil className="mr-1 h-3 w-3" /> Editar
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-4 space-y-4 rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
          <h2 className="font-semibold">Editar inventário</h2>
          <div className="space-y-2">
            <Label htmlFor="ename">Nome</Label>
            <Input id="ename" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Frequência</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as "daily" | "weekly" | "monthly")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Diária</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="monthly">Mensal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {frequency === "weekly" && (
              <div className="space-y-2">
                <Label>Dia da semana</Label>
                <Select value={weekday} onValueChange={setWeekday}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((w, i) => <SelectItem key={i} value={String(i)}>{w}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="etime">Horário</Label>
              <Input id="etime" type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Grupos contados</Label>
            <div className="space-y-1">
              {data.allGroups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-muted/50">
                  <Checkbox checked={selectedGroups.has(g.id)} onCheckedChange={() => toggleGroup(g.id)} />
                  <span className="text-sm font-medium">{g.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}><X className="mr-1 h-4 w-4" /> Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving}><Save className="mr-1 h-4 w-4" />{saving ? "Salvando..." : "Salvar"}</Button>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <h2 className="font-semibold">Link único de contagem</h2>
        <p className="text-xs text-muted-foreground">Compartilhe com os responsáveis pela contagem.</p>
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input readOnly value={link} className="flex-1 rounded-md border bg-muted px-3 py-2 text-xs" />
            <Button variant="outline" size="sm" onClick={copyLink}><Copy className="h-3 w-3" /></Button>
          </div>
          <div className="flex gap-2">
            <Input placeholder="WhatsApp (5511...)" value={phone} onChange={(e) => setPhone(e.target.value)} className="text-sm" />
            <Button size="sm" asChild disabled={cleanPhone.length < 10}>
              <a href={waLink} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-1 h-3 w-3" /> Enviar
              </a>
            </Button>
          </div>

          {contacts && contacts.length > 0 && (
            <div className="space-y-1 pt-2">
              <p className="text-xs font-medium text-muted-foreground">Contatos salvos</p>
              <div className="flex flex-wrap gap-2">
                {contacts.map((c) => (
                  <div key={c.id} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 pl-3 pr-1 py-1 text-xs">
                    <button type="button" onClick={() => setPhone(c.phone)} className="hover:text-primary">
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-1 text-muted-foreground">{c.phone}</span>
                    </button>
                    <button type="button" onClick={() => deleteContact(c.id)} className="rounded-full p-1 opacity-50 hover:bg-destructive/10 hover:opacity-100" aria-label="Remover">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Dialog open={contactDialog} onOpenChange={setContactDialog}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-start text-xs"><UserPlus className="mr-1 h-3 w-3" /> Adicionar contato</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo contato</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="cname">Nome</Label>
                  <Input id="cname" value={newContactName} onChange={(e) => setNewContactName(e.target.value)} placeholder="Ex: João Cozinha" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cphone">WhatsApp</Label>
                  <Input id="cphone" value={newContactPhone} onChange={(e) => setNewContactPhone(e.target.value)} placeholder="5511999999999" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setContactDialog(false)}>Cancelar</Button>
                <Button onClick={async () => { await addContact(); setContactDialog(false); }}><Plus className="mr-1 h-4 w-4" /> Salvar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <h2 className="mt-8 font-semibold">Contagem por grupo</h2>
      <p className="text-xs text-muted-foreground">Valores enviados pelos responsáveis em cada grupo.</p>
      <div className="mt-2 space-y-4">
        {data.groups.map((g) => {
          const groupItems = data.items.filter((it) => it.group_id === g.id);
          return (
            <div key={g.id} className="rounded-xl border bg-card shadow-[var(--shadow-soft)]">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <h3 className="font-semibold text-sm">{g.name}</h3>
                <span className="text-xs text-muted-foreground">{groupItems.filter((i) => i.counted_qty != null).length}/{groupItems.length} contados</span>
              </div>
              <div className="divide-y">
                {groupItems.length === 0 ? (
                  <p className="p-3 text-center text-xs text-muted-foreground">Sem insumos neste grupo.</p>
                ) : groupItems.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="text-sm">{it.ingredient_name}</div>
                    <div className="text-right text-sm">
                      {it.counted_qty != null ? (
                        <span className="font-medium">{Number(it.counted_qty).toFixed(2)} {it.unit}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">aguardando</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="mt-8 font-semibold">Totais consolidados</h2>
      <p className="text-xs text-muted-foreground">Quando um insumo aparece em vários grupos, somamos as contagens.</p>
      <div className="mt-2 divide-y rounded-xl border bg-card shadow-[var(--shadow-soft)]">
        {totalsArr.map(([ingId, t]) => (
          <div key={ingId} className="flex items-center justify-between gap-3 p-3">
            <div className="text-sm font-medium">{t.name}</div>
            <div className="text-right text-sm">
              {t.counted ? (
                <div className="font-display text-lg">{t.total.toFixed(2)} {t.unit}</div>
              ) : (
                <span className="text-xs text-muted-foreground">aguardando</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" className="text-destructive" onClick={remove}>
          <Trash2 className="mr-2 h-4 w-4" /> Excluir inventário
        </Button>
        <Button onClick={handleFinalize} disabled={finalizing || !anyCounted}>
          <CheckCheck className="mr-2 h-4 w-4" />
          {finalizing ? "Finalizando..." : "Finalizar e atualizar estoque"}
        </Button>
      </div>
      {data.inv.last_completed_at && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border bg-primary/10 p-4 text-sm text-primary">
          <CheckCircle2 className="h-5 w-5" /> Última atualização do estoque: {new Date(data.inv.last_completed_at).toLocaleString("pt-BR")}
        </div>
      )}
    </div>
  );
}
