import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, PackageCheck, Send, Trash2, Check, X, Pencil } from "lucide-react";

export const Route = createFileRoute("/_authenticated/purchases/orders")({
  component: OrdersPage,
});

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
    const { error } = await (supabase as any).from("purchase_orders").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(status === "received" ? "Marcado como recebido" : "Cancelado");
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
          {grouped.map(([supplier, items]) => (
            <div key={supplier} className="rounded-xl border bg-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 p-3">
                <div className="font-semibold flex items-center gap-2">
                  {supplier}
                  <Badge variant="secondary">{items.length}</Badge>
                </div>
                <Button size="sm" onClick={() => setWaTarget({ supplier, message: buildMessage(supplier, items) })}>
                  <Send className="mr-1 h-4 w-4" /> Enviar ordem no WhatsApp
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Insumo</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead>Previsão</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.ingredient?.name ?? "—"}</TableCell>
                      <TableCell className="text-right">{QTY.format(Number(o.quantity))} {o.unit}</TableCell>
                      <TableCell>{formatBR(o.expected_at)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{o.notes ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(o)} title="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => updateStatus(o.id, "received")} title="Recebido">
                            <Check className="h-4 w-4 text-emerald-600" />
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
          ))}
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
    </div>
  );
}
