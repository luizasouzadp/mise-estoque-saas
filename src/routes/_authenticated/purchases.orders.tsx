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
import { ArrowLeft, PackageCheck, Send, Trash2, X, Pencil, Plus, CheckCircle2, Camera, Image as ImageIcon, Loader2 } from "lucide-react";
import { useUserRoles } from "@/hooks/use-roles";


export const Route = createFileRoute("/_authenticated/purchases/orders")({
  component: OrdersPage,
});

type SupplierOpt = { id: string; name: string };
type IngredientOpt = { id: string; name: string; unit: string; last_cost?: number; avg_cost?: number };
type NewOrderLine = { ingredient_id: string; quantity: string; unit: string; expected_at: string; notes: string };

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
  const { isReceiver } = useUserRoles();
  const [looseOpen, setLooseOpen] = useState(false);
  const [looseSupplier, setLooseSupplier] = useState("");
  const [looseNotes, setLooseNotes] = useState("");
  const [looseFiles, setLooseFiles] = useState<File[]>([]);
  const [loosePreviews, setLoosePreviews] = useState<string[]>([]);
  const [looseSaving, setLooseSaving] = useState(false);
  const looseCameraRef = useRef<HTMLInputElement | null>(null);
  const looseGalleryRef = useRef<HTMLInputElement | null>(null);
  const [waTarget, setWaTarget] = useState<null | { supplier: string; message: string }>(null);

  const [editing, setEditing] = useState<OrderRow | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editExpected, setEditExpected] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newSupplierText, setNewSupplierText] = useState<string>("");
  const [newExpected, setNewExpected] = useState<string>("");
  const [newLines, setNewLines] = useState<NewOrderLine[]>([
    { ingredient_id: "", quantity: "", unit: "", expected_at: "", notes: "" },
  ]);
  const [receiveTarget, setReceiveTarget] = useState<null | { supplier: string; items: OrderRow[] }>(null);
  const [receiveFiles, setReceiveFiles] = useState<File[]>([]);
  const [receivePreviews, setReceivePreviews] = useState<string[]>([]);

  const [receiveNotes, setReceiveNotes] = useState("");
  const [receiveMode, setReceiveMode] = useState<"nota" | "sem_nota">("nota");
  const [receiveItems, setReceiveItems] = useState<OrderRow[]>([]);
  const [manualLines, setManualLines] = useState<Record<string, { qty: string; cost: string }>>({});
  const [receiving, setReceiving] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [addTarget, setAddTarget] = useState<null | { supplier: string; supplier_id: string | null; supplier_name: string | null; expected_at: string | null }>(null);
  const [addIngredient, setAddIngredient] = useState("");
  const [addQty, setAddQty] = useState("");
  const [addUnit, setAddUnit] = useState("");
  const [addExpected, setAddExpected] = useState("");
  const [addingItem, setAddingItem] = useState(false);
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
      const { data } = await supabase.from("ingredients").select("id, name, unit, last_cost, avg_cost").order("name");
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
    setReceiveItems([...items]);
    setReceiveFiles([]);
    setReceivePreviews([]);
    setReceiveNotes("");
    setReceiveMode("nota");
    const map: Record<string, { qty: string; cost: string }> = {};
    for (const it of items) {
      const ing = (ingredients ?? []).find((g) => g.id === it.ingredient_id);
      const cost = Number(ing?.last_cost || ing?.avg_cost || 0);
      map[it.id] = {
        qty: String(Number(it.quantity)).replace(".", ","),
        cost: cost ? String(cost).replace(".", ",") : "",
      };
    }
    setManualLines(map);
  }

  function parseNum(v: string) {
    const n = Number(String(v).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }

  function updateReceiveItemIngredient(id: string, ingredient_id: string) {
    const ing = (ingredients ?? []).find((g) => g.id === ingredient_id);
    if (!ing) return;
    setReceiveItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? { ...it, ingredient_id: ing.id, unit: ing.unit, ingredient: { name: ing.name } }
          : it,
      ),
    );
    const cost = Number(ing.last_cost || ing.avg_cost || 0);
    setManualLines((m) => ({
      ...m,
      [id]: { qty: m[id]?.qty ?? "", cost: cost ? String(cost).replace(".", ",") : m[id]?.cost ?? "" },
    }));
  }

  function removeReceiveItem(id: string) {
    setReceiveItems((prev) => prev.filter((it) => it.id !== id));
    setManualLines((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }

  async function confirmReceiveWithoutInvoice() {
    if (!receiveTarget || receiveItems.length === 0) return;
    const rowsInput = receiveItems.map((it) => ({
      it,
      qty: parseNum(manualLines[it.id]?.qty ?? ""),
      cost: parseNum(manualLines[it.id]?.cost ?? ""),
    }));
    if (rowsInput.some((r) => !Number.isFinite(r.qty) || r.qty <= 0)) {
      return toast.error("Informe a quantidade recebida de todos os itens");
    }
    if (rowsInput.some((r) => !Number.isFinite(r.cost) || r.cost < 0)) {
      return toast.error("Informe o custo unitário de todos os itens");
    }
    setReceiving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { data: prof } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
      if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");

      const purchasedAt = new Date().toISOString();
      const purchaseRows = rowsInput.map((r) => ({
        restaurant_id: prof.restaurant_id,
        ingredient_id: r.it.ingredient_id,
        quantity: r.qty,
        unit_cost: r.cost,
        total_cost: Number((r.qty * r.cost).toFixed(2)),
        supplier: receiveTarget.supplier === "Sem fornecedor" ? null : receiveTarget.supplier,
        purchased_at: purchasedAt,
        created_by: u.user?.id ?? null,
      }));
      const { error: pErr } = await supabase.from("purchases").insert(purchaseRows as any);
      if (pErr) throw new Error(pErr.message);

      const ids = receiveItems.map((i) => i.id);
      const { error } = await (supabase as any)
        .from("purchase_orders")
        .update({
          status: "received",
          received_at: purchasedAt,
          receipt_notes: receiveNotes.trim() || "Recebido sem nota (conferência manual)",
          import_status: "imported",
        })
        .in("id", ids);
      if (error) throw new Error(error.message);

      toast.success("Recebimento confirmado e estoque atualizado.");
      setReceiveTarget(null);
      setSelected((s) => {
        const next = { ...s };
        for (const id of ids) delete next[id];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders-pending-ings"] });
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["ingredients"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["purchase-notes"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReceiving(false);
    }
  }

  async function addReceiptFiles(list: File[]) {
    if (!list.length) return;
    const urls = await Promise.all(
      list.map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(f);
          }),
      ),
    );
    setReceiveFiles((prev) => [...prev, ...list]);
    setReceivePreviews((prev) => [...prev, ...urls]);
  }

  function removeReceiptAt(idx: number) {
    setReceiveFiles((prev) => prev.filter((_, i) => i !== idx));
    setReceivePreviews((prev) => prev.filter((_, i) => i !== idx));
  }

  async function confirmReceive() {
    if (!receiveTarget) return;
    if (receiveFiles.length === 0) return toast.error("Anexe ao menos uma foto da nota");
    setReceiving(true);
    try {
      const { data: prof } = await supabase
        .from("profiles").select("restaurant_id").maybeSingle();
      if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");
      const uploadedPaths: string[] = [];
      for (const f of receiveFiles) {
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `${prof.restaurant_id}/${crypto.randomUUID()}.${ext || "jpg"}`;
        const { error: upErr } = await supabase.storage
          .from("purchase-invoices")
          .upload(path, f, {
            contentType: f.type || "image/jpeg",
            upsert: false,
          });
        if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);
        uploadedPaths.push(path);
      }

      const ids = receiveTarget.items.map((i) => i.id);
      const { error } = await (supabase as any)
        .from("purchase_orders")
        .update({
          status: "received",
          received_at: new Date().toISOString(),
          receipt_image_path: uploadedPaths[0],
          receipt_image_paths: uploadedPaths,
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

  function openLoose() {
    setLooseSupplier("");
    setLooseNotes("");
    setLooseFiles([]);
    setLoosePreviews([]);
    setLooseOpen(true);
  }

  async function addLooseFiles(list: File[]) {
    if (!list.length) return;
    const urls = await Promise.all(
      list.map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(f);
          }),
      ),
    );
    setLooseFiles((prev) => [...prev, ...list]);
    setLoosePreviews((prev) => [...prev, ...urls]);
  }

  async function saveLooseInvoice() {
    if (looseFiles.length === 0) return toast.error("Anexe ao menos uma foto da nota");
    setLooseSaving(true);
    try {
      const { data: prof } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
      if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");
      const paths: string[] = [];
      for (const f of looseFiles) {
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `${prof.restaurant_id}/${crypto.randomUUID()}.${ext || "jpg"}`;
        const { error: upErr } = await supabase.storage
          .from("purchase-invoices")
          .upload(path, f, { contentType: f.type || "image/jpeg", upsert: false });
        if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);
        paths.push(path);
      }
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("pending_invoices").insert({
        restaurant_id: prof.restaurant_id,
        supplier_name: looseSupplier.trim() || null,
        notes: looseNotes.trim() || null,
        image_paths: paths,
        status: "pending",
        created_by: userRes.user?.id ?? null,
      });
      if (error) throw new Error(error.message);
      toast.success("Nota enviada. Ficará pendente de entrada em Compras.");
      setLooseOpen(false);
      qc.invalidateQueries({ queryKey: ["pending-invoices"] });
      qc.invalidateQueries({ queryKey: ["purchase-notes"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLooseSaving(false);
    }
  }

  function resetNewOrder() {

    setNewSupplierText("");
    setNewExpected("");
    setNewLines([{ ingredient_id: "", quantity: "", unit: "", expected_at: "", notes: "" }]);
  }

  function addNewLine() {
    setNewLines((ls) => [...ls, { ingredient_id: "", quantity: "", unit: "", expected_at: "", notes: "" }]);
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
          unit: (l.unit ?? "").trim() || ing.unit,
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

  function openAddItem(supplier: string, items: OrderRow[]) {
    const first = items[0];
    setAddTarget({
      supplier,
      supplier_id: first?.supplier_id ?? null,
      supplier_name: first?.supplier_name ?? supplier,
      expected_at: first?.expected_at ?? null,
    });
    setAddIngredient("");
    setAddQty("");
    setAddUnit("");
    setAddExpected(first?.expected_at ?? "");
  }

  async function saveAddItem() {
    if (!addTarget) return;
    const ing = (ingredients ?? []).find((i) => i.id === addIngredient);
    if (!ing) return toast.error("Selecione um insumo");
    const q = Number(String(addQty).replace(",", "."));
    if (!isFinite(q) || q <= 0) return toast.error("Quantidade inválida");
    setAddingItem(true);
    try {
      const { data: prof } = await supabase
        .from("profiles").select("restaurant_id").maybeSingle();
      if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");
      const { error } = await (supabase as any).from("purchase_orders").insert({
        restaurant_id: prof.restaurant_id,
        supplier_id: addTarget.supplier_id,
        supplier_name: addTarget.supplier_name,
        ingredient_id: ing.id,
        quantity: q,
        unit: addUnit.trim() || ing.unit,
        expected_at: addExpected || null,
        status: "pending",
      });
      if (error) throw new Error(error.message);
      toast.success("Item adicionado à encomenda");
      setAddTarget(null);
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders-pending-ings"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAddingItem(false);
    }
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
        {!isReceiver && (
          <Link to="/purchases" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar às compras
          </Link>
        )}
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
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openLoose}>
              <Camera className="mr-1 h-4 w-4" /> Nota avulsa
            </Button>
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Nova encomenda
            </Button>
          </div>
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
                  <Button size="sm" variant="outline" onClick={() => openAddItem(supplier, items)}>
                    <Plus className="mr-1 h-4 w-4" /> Adicionar item
                  </Button>
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

      {/* Nota avulsa */}
      <Dialog open={looseOpen} onOpenChange={(o) => !o && !looseSaving && setLooseOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nota avulsa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Para mercadorias recebidas sem encomenda lançada. A nota fica pendente para o
              responsável dar entrada no estoque.
            </p>
            <div className="grid gap-2">
              <Label>Fornecedor (opcional)</Label>
              <Input
                value={looseSupplier}
                onChange={(e) => setLooseSupplier(e.target.value)}
                placeholder="Nome do fornecedor"
                list="loose-suppliers"
              />
              <datalist id="loose-suppliers">
                {(suppliers ?? []).map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>
            <div className="grid gap-2">
              <Label>Fotos da nota * (adicione várias páginas se necessário)</Label>
              <input
                ref={looseCameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  if (list.length) void addLooseFiles(list);
                  e.target.value = "";
                }}
              />
              <input
                ref={looseGalleryRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  if (list.length) void addLooseFiles(list);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => looseCameraRef.current?.click()}>
                  <Camera className="mr-2 h-4 w-4" /> Tirar foto
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => looseGalleryRef.current?.click()}>
                  <ImageIcon className="mr-2 h-4 w-4" /> Da galeria
                </Button>
              </div>
              {loosePreviews.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {loosePreviews.map((src, i) => (
                    <div key={i} className="relative overflow-hidden rounded-md border">
                      <img src={src} alt={`Página ${i + 1}`} className="h-24 w-full object-cover" />
                      <span className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{i + 1}</span>
                      <button
                        type="button"
                        aria-label="Remover página"
                        className="absolute left-1 top-1 rounded-full bg-background/90 p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          setLooseFiles((prev) => prev.filter((_, j) => j !== i));
                          setLoosePreviews((prev) => prev.filter((_, j) => j !== i));
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Observações / avarias</Label>
              <Textarea
                rows={3}
                value={looseNotes}
                onChange={(e) => setLooseNotes(e.target.value)}
                placeholder="Ex.: caixa amassada, faltou 1 unidade…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLooseOpen(false)} disabled={looseSaving}>Cancelar</Button>
            <Button onClick={saveLooseInvoice} disabled={looseSaving || looseFiles.length === 0}>
              {looseSaving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>) : "Enviar nota"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    <div key={idx} className="grid gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-[1fr_100px_130px_auto]">
                      <Select
                        value={line.ingredient_id}
                        onValueChange={(v) => {
                          const sel = (ingredients ?? []).find((i) => i.id === v);
                          updateNewLine(idx, { ingredient_id: v, unit: sel?.unit ?? "" });
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Insumo" /></SelectTrigger>
                        <SelectContent>
                          {(ingredients ?? []).map((i) => (
                            <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Qtd"
                        value={line.quantity}
                        onChange={(e) => updateNewLine(idx, { quantity: e.target.value })}
                      />
                      <Input
                        placeholder={ing ? ing.unit : "Unid. (ex.: cx)"}
                        value={line.unit}
                        onChange={(e) => updateNewLine(idx, { unit: e.target.value })}
                        maxLength={20}
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
            {!isReceiver && (
              <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={receiveMode === "nota" ? "default" : "ghost"}
                  onClick={() => setReceiveMode("nota")}
                >
                  Com nota
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={receiveMode === "sem_nota" ? "default" : "ghost"}
                  onClick={() => setReceiveMode("sem_nota")}
                >
                  Sem nota
                </Button>
              </div>
            )}

            {receiveMode === "nota" ? (
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
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Confira cada item da encomenda, ajuste insumo, quantidade e custo unitário. Itens removidos não entram no estoque.
                </p>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {receiveItems.map((it) => (
                    <div key={it.id} className="rounded-md border p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <Label className="text-xs">Insumo</Label>
                          <Select value={it.ingredient_id} onValueChange={(v) => updateReceiveItemIngredient(it.id, v)}>
                            <SelectTrigger className="mt-1 h-8 w-full text-sm">
                              <SelectValue placeholder="Selecione o insumo" />
                            </SelectTrigger>
                            <SelectContent>
                              {(ingredients ?? []).map((i) => (
                                <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="shrink-0 text-destructive"
                          onClick={() => removeReceiveItem(it.id)}
                          title="Remover item do recebimento"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div className="grid gap-1">
                          <Label className="text-xs">Qtd recebida ({it.unit})</Label>
                          <Input
                            inputMode="decimal"
                            value={manualLines[it.id]?.qty ?? ""}
                            onChange={(e) =>
                              setManualLines((m) => ({ ...m, [it.id]: { qty: e.target.value, cost: m[it.id]?.cost ?? "" } }))
                            }
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-xs">Custo unitário (R$)</Label>
                          <Input
                            inputMode="decimal"
                            value={manualLines[it.id]?.cost ?? ""}
                            onChange={(e) =>
                              setManualLines((m) => ({ ...m, [it.id]: { qty: m[it.id]?.qty ?? "", cost: e.target.value } }))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {receiveItems.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground">Nenhum item restante. Cancele ou troque para "Com nota".</p>
                )}
              </div>
            )}

            <div className="grid gap-2" hidden={receiveMode !== "nota"}>
              <Label>Fotos da nota fiscal * (adicione várias páginas se necessário)</Label>
              <input
                ref={receiveCameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  if (list.length) void addReceiptFiles(list);
                  e.target.value = "";
                }}
              />
              <input
                ref={receiveGalleryRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  if (list.length) void addReceiptFiles(list);
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
              {receivePreviews.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {receivePreviews.map((src, i) => (
                    <div key={i} className="relative overflow-hidden rounded-md border">
                      <img src={src} alt={`Página ${i + 1}`} className="h-24 w-full object-cover" />
                      <span className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        {i + 1}
                      </span>
                      <button
                        type="button"
                        aria-label="Remover página"
                        className="absolute left-1 top-1 rounded-full bg-background/90 p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => removeReceiptAt(i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
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
              {receiveMode === "nota"
                ? "A nota entrará no arquivo mensal e aparecerá como pendência em Compras para dar entrada dos itens."
                : "Os itens conferidos entram direto no estoque como compra, sem nota anexada."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReceiveTarget(null)} disabled={receiving}>Cancelar</Button>
            <Button
              onClick={receiveMode === "nota" ? confirmReceive : confirmReceiveWithoutInvoice}
              disabled={
                receiving ||
                (receiveMode === "nota" && receiveFiles.length === 0) ||
                (receiveMode === "sem_nota" && receiveItems.length === 0)
              }
            >
              {receiving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>) : "Confirmar recebimento"}
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add item to existing order */}
      <Dialog open={addTarget != null} onOpenChange={(o) => !o && !addingItem && setAddTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar item — {addTarget?.supplier}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Insumo</Label>
              <Select value={addIngredient} onValueChange={setAddIngredient}>
                <SelectTrigger><SelectValue placeholder="Selecione o insumo" /></SelectTrigger>
                <SelectContent>
                  {(ingredients ?? []).map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>
                Quantidade{(() => {
                  const ing = (ingredients ?? []).find((i) => i.id === addIngredient);
                  return ing ? ` (${ing.unit})` : "";
                })()}
              </Label>
              <Input value={addQty} onChange={(e) => setAddQty(e.target.value)} placeholder="0" />
            </div>
            <div className="grid gap-2">
              <Label>Previsão de chegada</Label>
              <Input type="date" value={addExpected} onChange={(e) => setAddExpected(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddTarget(null)} disabled={addingItem}>Cancelar</Button>
            <Button onClick={saveAddItem} disabled={addingItem}>
              {addingItem ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adicionando…</>) : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
