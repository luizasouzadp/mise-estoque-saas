import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/searchable-select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, PackageCheck, Send, Trash2, Check, X, Pencil, Plus, CheckCircle2, Camera, Image as ImageIcon, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/purchases/orders")({
  component: OrdersPage,
});

type SupplierOpt = { id: string; name: string };
type IngredientOpt = { id: string; name: string; unit: string };
type NewOrderLine = { ingredient_id: string; quantity: string; expected_at: string; notes: string };

const QTY = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

type OrderRow = {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  ingredient_id: string;
  quantity: number;
  unit: string;
  expected_at: string | null;
  status: "pending" | "received" | "cancelled";
  notes: string | null;
  created_at: string;
  ingredient: { name: string } | null;
};

function formatBR(s: string | null | undefined) {
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function OrdersPage() {
  const qc = useQueryClient();
  const [waTarget, setWaTarget] = useState<null | { supplier: string; message: string }>(null);
  const [editing, setEditing] = useState<OrderRow | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editExpected, setEditExpected] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newSupplierText, setNewSupplierText] = useState<string>("");
  const [newExpected, setNewExpected] = useState<string>("");
  const [newLines, setNewLines] = useState<NewOrderLine[]>([
    { ingredient_id: "", quantity: "", expected_at: "", notes: "" },
  ]);
  const [receiveTarget, setReceiveTarget] = useState<null | { supplier: string; items: OrderRow[] }>(null);
  const [receiveFile, setReceiveFile] = useState<File | null>(null);
  const [receivePreview, setReceivePreview] = useState<string | null>(null);
  const [receiveNotes, setReceiveNotes] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const receiveCameraRef = useRef<HTMLInputElement | null>(null);
  const receiveGalleryRef = useRef<HTMLInputElement | null>(null);

  function toggleSelect(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }
  function toggleSelectAll(items: OrderRow[]) {
    const allSelected = items.every((i) => selected[i.id]);
    setSelected((s) => {
      const next = { ...s };
      for (const i of items) next[i.id] = !allSelected;
      return next;
    });
  }

  const { data, isLoading } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("purchase_orders")
        .select("id, supplier_id, supplier_name, ingredient_id, quantity, unit, expected_at, status, notes, created_at, ingredient:ingredients(name)")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as OrderRow[];
    },
  });

  const { data: contacts } = useQuery<{ id: string; name: string; phone: string }[]>({
    queryKey: ["whatsapp_contacts"],
    queryFn: async () => {
      const { data } = await supabase.from("whatsapp_contacts").select("id, name, phone").order("name");
      return data ?? [];
    },
  });

  const { data: suppliers } = useQuery<SupplierOpt[]>({
    queryKey: ["suppliers-min"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: ingredients } = useQuery<IngredientOpt[]>({
    queryKey: ["ingredients-min"],
    queryFn: async () => {
      const { data } = await supabase.from("ingredients").select("id, name, unit").order("name");
      return (data ?? []) as IngredientOpt[];
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, OrderRow[]>();
    for (const o of data ?? []) {
      const key = o.supplier_name ?? "Sem fornecedor";
      const arr = map.get(key) ?? [];
      arr.push(o);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  async function updateStatus(id: string, status: "received" | "cancelled") {
    if (status === "received") {
      const o = (data ?? []).find((r) => r.id === id);
      if (!o) return;
      openReceive(o.supplier_name ?? "Sem fornecedor", [o]);
      return;
    }
    const { error } = await (supabase as any).from("purchase_orders").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Cancelado");
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["purchase-orders-pending-ings"] });
  }

  async function removeOrder(id: string) {
    if (!confirm("Excluir esta encomenda?")) return;
    const { error } = await (supabase as any).from("purchase_orders").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Excluída");
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["purchase-orders-pending-ings"] });
  }

  function openReceive(supplier: string, items: OrderRow[]) {
    setReceiveTarget({ supplier, items });
    setReceiveFile(null);
    setReceivePreview(null);
    setReceiveNotes("");
  }

  function onPickReceiptFile(f: File) {
    setReceiveFile(f);
    const r = new FileReader();
    r.onload = () => setReceivePreview(String(r.result));
    r.readAsDataURL(f);
  }

  async function confirmReceive() {
    if (!receiveTarget) return;
    if (!receiveFile) return toast.error("Anexe a foto da nota");
    setReceiving(true);
    try {
      const { data: prof } = await supabase
        .from("profiles").select("restaurant_id").maybeSingle();
      if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");
      const ext = (receiveFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${prof.restaurant_id}/${crypto.randomUUID()}.${ext || "jpg"}`;
      const { error: upErr } = await supabase.storage
        .from("purchase-invoices")
        .upload(path, receiveFile, {
          contentType: receiveFile.type || "image/jpeg",
          upsert: false,
        });
      if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

      const ids = receiveTarget.items.map((i) => i.id);
      const { error } = await (supabase as any)
        .from("purchase_orders")
        .update({
          status: "received",
          received_at: new Date().toISOString(),
          receipt_image_path: path,
          receipt_notes: receiveNotes.trim() || null,
          import_status: "pending",
        })
        .in("id", ids);
      if (error) throw new Error(error.message);

      toast.success("Recebimento registrado. Nota disponível em Compras.");
      setReceiveTarget(null);
      setSelected((s) => {
        const next = { ...s };
        for (const id of ids) delete next[id];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders-pending-ings"] });
      qc.invalidateQueries({ queryKey: ["purchase-notes"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders-pending-import"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReceiving(false);
    }
  }

  function resetNewOrder() {
    setNewSupplierText("");
    setNewExpected("");
    setNewLines([{ ingredient_id: "", quantity: "", expected_at: "", notes: "" }]);
  }

  function addNewLine() {
    setNewLines((ls) => [...ls, { ingredient_id: "", quantity: "", expected_at: "", notes: "" }]);
  }
  function updateNewLine(idx: number, patch: Partial<NewOrderLine>) {
    setNewLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function removeNewLine(idx: number) {
    setNewLines((ls) => ls.filter((_, i) => i !== idx));
  }

  async function saveNewOrder() {
    const name = newSupplierText.trim();
    if (!name) return toast.error("Informe o fornecedor");
    if (name.length > 120) return toast.error("Nome do fornecedor muito longo");
    const existing = (suppliers ?? []).find(
      (s) => s.name.trim().toLowerCase() === name.toLowerCase(),
    );
    const rows = newLines
      .map((l) => {
        const ing = (ingredients ?? []).find((i) => i.id === l.ingredient_id);
        const q = Number(String(l.quantity).replace(",", "."));
        if (!ing || !isFinite(q) || q <= 0) return null;
        return {
          supplier_id: existing?.id ?? null,
          supplier_name: existing?.name ?? name,
          ingredient_id: ing.id,
          quantity: q,
          unit: ing.unit,
          expected_at: newExpected || null,
          notes: l.notes || null,
          status: "pending" as const,
        };
      })
      .filter(Boolean);
    if (rows.length === 0) return toast.error("Adicione ao menos um item válido");

    const { data: prof } = await supabase
      .from("profiles").select("restaurant_id").maybeSingle();
    if (!prof?.restaurant_id) return toast.error("Restaurante não encontrado");
    const payload = rows.map((r) => ({ ...(r as object), restaurant_id: prof.restaurant_id }));
    const { error } = await (supabase as any).from("purchase_orders").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Encomenda criada");
    setNewOpen(false);
    resetNewOrder();
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["purchase-orders-pending-ings"] });
  }

  function openEdit(o: OrderRow) {
    setEditing(o);
    setEditQty(String(o.quantity));
    setEditExpected(o.expected_at ?? "");
  }

  async function saveEdit() {
    if (!editing) return;
    const q = Number(String(editQty).replace(",", "."));
    if (!isFinite(q) || q <= 0) return toast.error("Quantidade inválida");
    const { error } = await (supabase as any).from("purchase_orders").update({
      quantity: q, expected_at: editExpected || null,
    }).eq("id", editing.id);
    if (error) return toast.error(error.message);
    toast.success("Atualizado");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
  }

  function buildMessage(supplier: string, items: OrderRow[]) {
    const lines = [`*Ordem de compra — ${supplier}*`, ""];
    for (const it of items) {
      const eta = it.expected_at ? ` (chegada ${formatBR(it.expected_at)})` : "";
      lines.push(`• ${it.ingredient?.name ?? "—"}: ${QTY.format(Number(it.quantity))} ${it.unit}${eta}`);
    }
    lines.push("", `Total de itens: ${items.length}`);
    return lines.join("\n");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div>
        <Link to="/purchases" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="mr-1 h-4 w-4" /> Voltar às compras
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl flex items-center gap-2">
              <PackageCheck className="h-6 w-6 text-emerald-600" /> Encomendas
            </h1>
            <p className="text-sm text-muted-foreground">
              Encomendas pendentes agrupadas por fornecedor. Envie a ordem de compra pelo WhatsApp
              para os contatos cadastrados.
            </p>
          </div>
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Nova encomenda
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed bg-card/50 p-12 text-center">
          <PackageCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-4 font-semibold">Nenhuma encomenda pendente</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Marque itens como "Já encomendado" na Lista de compras.
          </p>
          <Button asChild className="mt-4"><Link to="/purchases/shopping-list">Ir para lista de compras</Link></Button>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([supplier, items]) => {
            const selectedItems = items.filter((i) => selected[i.id]);
            const allSelected = items.length > 0 && selectedItems.length === items.length;
            const someSelected = selectedItems.length > 0 && !allSelected;
            return (
            <div key={supplier} className="rounded-xl border bg-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 p-3">
                <div className="font-semibold flex items-center gap-2">
                  {supplier}
                  <Badge variant="secondary">{items.length}</Badge>
                  {selectedItems.length > 0 && (
                    <Badge className="bg-emerald-600 text-white">{selectedItems.length} selecionado(s)</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedItems.length === 0}
                    onClick={() => openReceive(supplier, selectedItems)}
                  >
                    <CheckCircle2 className="mr-1 h-4 w-4 text-emerald-600" /> Confirmar recebimento
                    {selectedItems.length > 0 ? ` (${selectedItems.length})` : ""}
                  </Button>
                  <Button size="sm" onClick={() => setWaTarget({ supplier, message: buildMessage(supplier, items) })}>
                    <Send className="mr-1 h-4 w-4" /> Enviar ordem no WhatsApp
                  </Button>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos"
                        className="h-4 w-4 accent-emerald-600"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={() => toggleSelectAll(items)}
                      />
                    </TableHead>
                    <TableHead>Insumo</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead>Previsão</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((o) => (
                    <TableRow key={o.id} data-state={selected[o.id] ? "selected" : undefined}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${o.ingredient?.name ?? ""}`}
                          className="h-4 w-4 accent-emerald-600"
                          checked={!!selected[o.id]}
                          onChange={() => toggleSelect(o.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{o.ingredient?.name ?? "—"}</TableCell>
                      <TableCell className="text-right">{QTY.format(Number(o.quantity))} {o.unit}</TableCell>
                      <TableCell>{formatBR(o.expected_at)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{o.notes ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(o)} title="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => updateStatus(o.id, "cancelled")} title="Cancelar">
                            <X className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => removeOrder(o.id)} title="Excluir">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            );
          })}
        </div>
      )}

      {/* WhatsApp picker */}
      <Dialog open={waTarget != null} onOpenChange={(o) => !o && setWaTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar ordem — {waTarget?.supplier}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Escolha um contato:</p>
            {(contacts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum contato cadastrado.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y rounded-md border">
                {(contacts ?? []).map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 hover:bg-secondary/50 flex items-center justify-between"
                    onClick={() => {
                      if (!waTarget) return;
                      const raw = c.phone.replace(/\D/g, "");
                      const phone = raw.length === 10 || raw.length === 11 ? `55${raw}` : raw;
                      const url = `https://wa.me/${phone}?text=${encodeURIComponent(waTarget.message)}`;
                      window.open(url, "_blank");
                      setWaTarget(null);
                    }}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaTarget(null)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar encomenda — {editing?.ingredient?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <label className="text-sm">Quantidade ({editing?.unit})</label>
              <Input value={editQty} onChange={(e) => setEditQty(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm">Previsão de chegada</label>
              <Input type="date" value={editExpected} onChange={(e) => setEditExpected(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={saveEdit}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New order dialog */}
      <Dialog open={newOpen} onOpenChange={(o) => { setNewOpen(o); if (!o) resetNewOrder(); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nova encomenda</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Fornecedor</Label>
                <Input
                  list="orders-supplier-options"
                  value={newSupplierText}
                  onChange={(e) => setNewSupplierText(e.target.value)}
                  placeholder="Nome do fornecedor"
                  maxLength={120}
                />
                <datalist id="orders-supplier-options">
                  {(suppliers ?? []).map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-2">
                <Label>Previsão de chegada (padrão)</Label>
                <Input type="date" value={newExpected} onChange={(e) => setNewExpected(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Itens do pedido</Label>
                <Button size="sm" variant="outline" onClick={addNewLine}>
                  <Plus className="mr-1 h-4 w-4" /> Adicionar item
                </Button>
              </div>
              <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-md border p-2">
                {newLines.map((line, idx) => {
                  const ing = (ingredients ?? []).find((i) => i.id === line.ingredient_id);
                  return (
                    <div key={idx} className="grid gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-[1fr_140px_auto]">
                      <Select value={line.ingredient_id} onValueChange={(v) => updateNewLine(idx, { ingredient_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Insumo" /></SelectTrigger>
                        <SelectContent>
                          {(ingredients ?? []).map((i) => (
                            <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder={`Qtd${ing ? ` (${ing.unit})` : ""}`}
                        value={line.quantity}
                        onChange={(e) => updateNewLine(idx, { quantity: e.target.value })}
                      />
                      <Button size="icon" variant="ghost" onClick={() => removeNewLine(idx)} title="Remover">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setNewOpen(false); resetNewOrder(); }}>Cancelar</Button>
            <Button onClick={saveNewOrder}>Criar encomenda</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt confirmation dialog */}
      <Dialog open={receiveTarget != null} onOpenChange={(o) => !o && !receiving && setReceiveTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirmar recebimento — {receiveTarget?.supplier}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="mb-1 font-medium">{receiveTarget?.items.length} item(ns) sendo recebidos</p>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                {receiveTarget?.items.map((it) => (
                  <li key={it.id}>
                    • {it.ingredient?.name ?? "—"}: {QTY.format(Number(it.quantity))} {it.unit}
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-2">
              <Label>Foto da nota fiscal *</Label>
              <input
                ref={receiveCameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickReceiptFile(f);
                  e.target.value = "";
                }}
              />
              <input
                ref={receiveGalleryRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickReceiptFile(f);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => receiveCameraRef.current?.click()}>
                  <Camera className="mr-2 h-4 w-4" /> Tirar foto
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => receiveGalleryRef.current?.click()}>
                  <ImageIcon className="mr-2 h-4 w-4" /> Da galeria
                </Button>
              </div>
              {receivePreview && (
                <img src={receivePreview} alt="Prévia da nota" className="mt-2 max-h-56 rounded-md border object-contain" />
              )}
            </div>

            <div className="grid gap-2">
              <Label>Observações / avarias</Label>
              <Textarea
                placeholder="Ex.: 2 caixas amassadas, faltou 1 unidade…"
                value={receiveNotes}
                onChange={(e) => setReceiveNotes(e.target.value)}
                rows={3}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              A nota entrará no arquivo mensal e aparecerá como pendência em Compras para dar entrada dos itens.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReceiveTarget(null)} disabled={receiving}>Cancelar</Button>
            <Button onClick={confirmReceive} disabled={receiving || !receiveFile}>
              {receiving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>) : "Confirmar recebimento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
