import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Trash2, AlertTriangle, TrendingDown, CheckCircle2,
  ClipboardList, Send,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/purchases/shopping-list")({
  component: ShoppingListPage,
});

const QTY = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

type ProjectedRow = {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  current_stock: number;
  min_stock: number;
  projected_stock: number;
  anchor_at: string;
  days_since_anchor: number;
  consumed_since_anchor: number;
  status: "zerado" | "abaixo_minimo" | "proximo_minimo" | "ok";
};

type ListItem = {
  ingredient_id: string;
  name: string;
  unit: string;
  qty: number;
  addedAt: string;
};

const LS_KEY = "purchases.shopping-list.v3";
const OLD_LS_KEY = "purchases.shopping-lists.v2";

function loadList(): ListItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return (JSON.parse(raw) as ListItem[]) ?? [];
    // Migrate from the old two-lists format, if present.
    const oldRaw = localStorage.getItem(OLD_LS_KEY);
    if (oldRaw) {
      const old = JSON.parse(oldRaw) as { emergency?: ListItem[]; orders?: ListItem[] };
      const merged = [...(old.emergency ?? []), ...(old.orders ?? [])];
      const byId = new Map(merged.map((it) => [it.ingredient_id, it]));
      return Array.from(byId.values());
    }
    return [];
  } catch {
    return [];
  }
}
function saveList(items: ListItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatBR(s: string) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function parseQty(input: string): number | null {
  const v = Number(String(input).replace(",", "."));
  return isFinite(v) && v > 0 ? v : null;
}

function ShoppingListPage() {
  const nav = useNavigate();

  const [list, setList] = useState<ListItem[]>(() => loadList());
  useEffect(() => { saveList(list); }, [list]);

  const [showList, setShowList] = useState(false);
  const [waPickOpen, setWaPickOpen] = useState(false);
  const [waManualPhone, setWaManualPhone] = useState("");
  const [waTarget, setWaTarget] = useState<{ name: string; phone: string; isSupplier: boolean } | null>(null);
  const [waMessage, setWaMessage] = useState("");

  const { data: projected, isLoading: projLoading } = useQuery<ProjectedRow[]>({
    queryKey: ["projected-stock-status"],
    queryFn: async () => {
      const [{ data, error }, prepRes] = await Promise.all([
        supabase.rpc("projected_stock_status"),
        supabase.from("ingredients").select("id, source_recipe_id, is_active"),
      ]);
      if (error) throw error;
      const preps = new Set(
        ((prepRes.data ?? []) as { id: string; source_recipe_id: string | null }[])
          .filter((i) => i.source_recipe_id).map((i) => i.id),
      );
      const inactive = new Set(
        ((prepRes.data ?? []) as { id: string; is_active: boolean | null }[])
          .filter((i) => i.is_active === false).map((i) => i.id),
      );
      const rows = ((data ?? []) as unknown[]) as ProjectedRow[];
      const order = { zerado: 0, abaixo_minimo: 1, proximo_minimo: 2, ok: 3 };
      return rows.filter((r) => !preps.has(r.ingredient_id) && !inactive.has(r.ingredient_id)).sort((a, b) => order[a.status] - order[b.status]);
    },
  });

  const { data: contacts } = useQuery<{ id: string; name: string; phone: string }[]>({
    queryKey: ["whatsapp_contacts"],
    queryFn: async () => {
      const { data } = await supabase.from("whatsapp_contacts").select("id, name, phone").order("name");
      return data ?? [];
    },
  });

  const { data: suppliers } = useQuery<{ id: string; name: string; phone: string | null }[]>({
    queryKey: ["suppliers-with-phone"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id, name, phone").order("name");
      return ((data ?? []) as { id: string; name: string; phone: string | null }[]).filter((s) => s.phone);
    },
  });

  // Only show items below (or near) minimum
  const alertRows = (projected ?? []).filter((r) => r.status !== "ok");
  const zeroed = alertRows.filter((r) => r.status === "zerado");
  const below = alertRows.filter((r) => r.status === "abaixo_minimo");
  const near = alertRows.filter((r) => r.status === "proximo_minimo");

  function addToList(row: ProjectedRow) {
    const suggested = Math.max(0, Number(row.min_stock) - Number(row.current_stock));
    const raw = window.prompt(
      `Quantidade a comprar (${row.unit}) para ${row.ingredient_name}:`,
      suggested > 0 ? QTY.format(suggested) : "",
    );
    if (raw == null) return;
    const qty = parseQty(raw);
    if (qty == null) return toast.error("Quantidade inválida");
    setList((prev) => {
      const existing = prev.find((x) => x.ingredient_id === row.ingredient_id);
      if (existing) {
        return prev.map((x) => x.ingredient_id === row.ingredient_id ? { ...x, qty, addedAt: new Date().toISOString() } : x);
      }
      return [...prev, { ingredient_id: row.ingredient_id, name: row.ingredient_name, unit: row.unit, qty, addedAt: new Date().toISOString() }];
    });
    toast.success("Adicionado à lista de compras");
  }

  function updateItemQty(ingredient_id: string, qty: number) {
    setList((prev) => prev.map((x) => x.ingredient_id === ingredient_id ? { ...x, qty } : x));
  }
  function removeItem(ingredient_id: string) {
    setList((prev) => prev.filter((x) => x.ingredient_id !== ingredient_id));
  }

  function buildMessage(items: ListItem[], isSupplier: boolean) {
    const lines = isSupplier
      ? [`Olá! Gostaria de encomendar a lista abaixo — ${formatBR(todayISO())}`, ""]
      : [`*Lista de compras* — ${formatBR(todayISO())}`, ""];
    for (const it of items) lines.push(`• ${it.name}: ${QTY.format(it.qty)} ${it.unit}`);
    lines.push("", `Total de itens: ${items.length}`);
    return lines.join("\n");
  }

  function pickTarget(name: string, phone: string, isSupplier: boolean) {
    setWaTarget({ name, phone, isSupplier });
    setWaMessage(buildMessage(list, isSupplier));
    setWaPickOpen(false);
    setWaManualPhone("");
  }

  function pickManualNumber() {
    const cleaned = waManualPhone.replace(/\D/g, "");
    if (cleaned.length < 10) return toast.error("Informe um telefone válido (DDD + número)");
    pickTarget(waManualPhone, cleaned, false);
  }

  function sendWhatsapp() {
    if (!waTarget) return;
    const raw = waTarget.phone.replace(/\D/g, "");
    const phone = raw.length === 10 || raw.length === 11 ? `55${raw}` : raw;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(waMessage)}`;
    window.open(url, "_blank");
    setWaTarget(null);
    setWaMessage("");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      <div>
        <Link to="/purchases" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="mr-1 h-4 w-4" /> Voltar às compras
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">Lista de compras</h1>
            <p className="text-sm text-muted-foreground">
              Insumos abaixo do mínimo (excluindo sub-receitas).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setShowList(true)}>
              <ClipboardList className="mr-1 h-4 w-4" />
              Lista de compras
              {list.length > 0 && <Badge variant="secondary" className="ml-2">{list.length}</Badge>}
            </Button>
          </div>
        </div>
      </div>

      {/* Alertas */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Insumos abaixo do mínimo
          </h2>
        </div>

        {projLoading ? (
          <div className="rounded-lg border p-6 text-sm text-muted-foreground">Calculando…</div>
        ) : alertRows.length === 0 ? (
          <div className="rounded-lg border border-success/40 bg-success/10 p-6 text-sm text-success dark:bg-success/15 dark:text-success flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Nenhum insumo em risco no momento.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard tone="destructive" label="Zerados" count={zeroed.length} desc="Sem estoque" />
            <SummaryCard tone="destructive" label="Abaixo do mínimo" count={below.length} desc="Comprar já" />
            <SummaryCard tone="warning" label="Próximos do mínimo" count={near.length} desc="Menos de 15% de folga" />
          </div>
        )}

        {alertRows.length > 0 && (
          <div className="rounded-xl border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Estoque atual</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertRows.map((r) => (
                  <TableRow key={r.ingredient_id} className="cursor-pointer hover:bg-secondary/40"
                    onClick={() => nav({ to: "/ingredients/$id", params: { id: r.ingredient_id } })}>
                    <TableCell className="font-medium">{r.ingredient_name}</TableCell>
                    <TableCell className={`text-right font-medium ${r.status === "zerado" || r.status === "abaixo_minimo" ? "text-destructive" : "text-amber-600"}`}>
                      {QTY.format(Number(r.current_stock))} {r.unit}
                    </TableCell>
                    <TableCell className="text-right">{QTY.format(Number(r.min_stock))} {r.unit}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" onClick={() => addToList(r)}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar à lista
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Diálogo da lista de compras */}
      <ListDialog
        open={showList}
        onClose={() => setShowList(false)}
        items={list}
        onQtyChange={updateItemQty}
        onRemove={removeItem}
        onSend={() => setWaPickOpen(true)}
      />

      {/* WhatsApp: escolher fornecedor, contato ou digitar número */}
      <Dialog open={waPickOpen} onOpenChange={setWaPickOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar por WhatsApp</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Fornecedores cadastrados</p>
              {(suppliers ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum fornecedor com telefone cadastrado. Adicione em "Fornecedores".</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {(suppliers ?? []).map((s) => (
                    <button
                      key={s.id}
                      className="w-full text-left px-3 py-2 hover:bg-secondary/50 flex items-center justify-between"
                      onClick={() => pickTarget(s.name, s.phone!, true)}
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{s.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Contatos salvos</p>
              {(contacts ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum contato cadastrado.</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {(contacts ?? []).map((c) => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2 hover:bg-secondary/50 flex items-center justify-between"
                      onClick={() => pickTarget(c.name, c.phone, false)}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">Ou digite um número</p>
              <div className="flex gap-2">
                <Input
                  value={waManualPhone}
                  onChange={(e) => setWaManualPhone(e.target.value)}
                  placeholder="11999998888"
                  inputMode="numeric"
                />
                <Button variant="outline" onClick={pickManualNumber}>Usar</Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaPickOpen(false)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WhatsApp: revisar e editar mensagem */}
      <Dialog open={waTarget != null} onOpenChange={(o) => !o && setWaTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mensagem para {waTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Você pode editar o texto antes de enviar:</p>
            <Textarea value={waMessage} onChange={(e) => setWaMessage(e.target.value)} rows={10} className="font-mono text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setWaTarget(null); setWaPickOpen(true); }}>Voltar</Button>
            <Button onClick={sendWhatsapp}>
              <Send className="mr-1 h-4 w-4" /> Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ListDialog({
  open, onClose, items, onQtyChange, onRemove, onSend,
}: {
  open: boolean;
  onClose: () => void;
  items: ListItem[];
  onQtyChange: (ingredient_id: string, qty: number) => void;
  onRemove: (ingredient_id: string) => void;
  onSend: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lista de compras</DialogTitle>
        </DialogHeader>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhum item na lista.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.ingredient_id}>
                    <TableCell className="font-medium">{it.name}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          type="number"
                          step="0.001"
                          value={it.qty}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (isFinite(v) && v >= 0) onQtyChange(it.ingredient_id, v);
                          }}
                          className="h-8 w-24 text-right"
                        />
                        <span className="text-xs text-muted-foreground w-8 text-left">{it.unit}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => onRemove(it.ingredient_id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={onSend} disabled={items.length === 0}>
            <Send className="mr-1 h-4 w-4" /> Enviar por WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ tone, label, count, desc }: { tone: "destructive" | "warning"; label: string; count: number; desc: string }) {
  const cls = tone === "destructive"
    ? "border-destructive/40 bg-destructive/5"
    : "border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20";
  const Icon = tone === "destructive" ? AlertTriangle : TrendingDown;
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-1 text-3xl font-semibold">{count}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: ProjectedRow["status"] }) {
  if (status === "zerado") return <Badge variant="destructive">Zerado</Badge>;
  if (status === "abaixo_minimo") return <Badge variant="destructive">Abaixo do mínimo</Badge>;
  if (status === "proximo_minimo") return <Badge variant="outline" className="text-amber-700 border-amber-500/60">Próximo</Badge>;
  return <Badge variant="secondary">OK</Badge>;
}
