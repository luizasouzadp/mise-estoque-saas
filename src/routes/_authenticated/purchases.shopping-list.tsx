import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/searchable-select";
import { toast } from "sonner";
import {
  ArrowLeft, Plus, Trash2, AlertTriangle, TrendingDown, CheckCircle2,
  ChevronDown, ClipboardList, PackageCheck, Send, X, Upload,
} from "lucide-react";
import {
  createDailySalesReport,
  deleteDailySalesReport,
} from "@/lib/daily-sales.functions";

export const Route = createFileRoute("/_authenticated/purchases/shopping-list")({
  component: ShoppingListPage,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const QTY = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

type DailyReport = {
  id: string;
  sales_date: string;
  file_name: string | null;
  total_revenue: number;
  total_quantity: number;
  mapped_count: number;
  unmapped_count: number;
  created_at: string;
};

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

type ListsState = {
  emergency: ListItem[];
  orders: ListItem[];
};

const LS_KEY = "purchases.shopping-lists.v2";

function loadLists(): ListsState {
  if (typeof window === "undefined") return { emergency: [], orders: [] };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { emergency: [], orders: [] };
    const parsed = JSON.parse(raw) as Partial<ListsState>;
    return { emergency: parsed.emergency ?? [], orders: parsed.orders ?? [] };
  } catch {
    return { emergency: [], orders: [] };
  }
}
function saveLists(s: ListsState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, JSON.stringify(s));
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
  const qc = useQueryClient();
  const nav = useNavigate();
  const [uploadOpen, setUploadOpen] = useState(false);

  const [lists, setLists] = useState<ListsState>(() => loadLists());
  useEffect(() => { saveLists(lists); }, [lists]);

  const [showEmergency, setShowEmergency] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [waTarget, setWaTarget] = useState<null | { title: string; message: string }>(null);
  const [orderTarget, setOrderTarget] = useState<null | { row: Pick<ProjectedRow, "ingredient_id" | "ingredient_name" | "unit" | "min_stock" | "projected_stock">; fromList?: "emergency" | "orders" }>(null);

  const { data: reports } = useQuery<DailyReport[]>({
    queryKey: ["daily-sales-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_sales_reports")
        .select("id, sales_date, file_name, total_revenue, total_quantity, mapped_count, unmapped_count, created_at")
        .order("sales_date", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as DailyReport[];
    },
  });

  // All ingredients projected + list of pre-preps (source_recipe_id) to exclude
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

  // Purchase orders already registered (pending) — remove ingredient from alerts
  const { data: pendingOrders } = useQuery<{ ingredient_id: string }[]>({
    queryKey: ["purchase-orders-pending-ings"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("purchase_orders")
        .select("ingredient_id")
        .eq("status", "pending");
      if (error) throw error;
      return (data ?? []) as { ingredient_id: string }[];
    },
  });
  const orderedIngSet = useMemo(
    () => new Set((pendingOrders ?? []).map((p) => p.ingredient_id)),
    [pendingOrders],
  );

  const del = useServerFn(deleteDailySalesReport);
  async function removeReport(id: string, dateLabel: string) {
    if (!confirm(`Excluir vendas de ${dateLabel}?`)) return;
    try {
      await del({ data: { id } });
      toast.success("Excluído");
      qc.invalidateQueries({ queryKey: ["daily-sales-reports"] });
      qc.invalidateQueries({ queryKey: ["projected-stock-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  // Only show items below (or near) minimum
  const alertRows = (projected ?? []).filter((r) => r.status !== "ok" && !orderedIngSet.has(r.ingredient_id));
  const zeroed = alertRows.filter((r) => r.status === "zerado");
  const below = alertRows.filter((r) => r.status === "abaixo_minimo");
  const near = alertRows.filter((r) => r.status === "proximo_minimo");

  function addToList(kind: "emergency" | "orders", row: ProjectedRow) {
    const suggested = Math.max(0, Number(row.min_stock) - Number(row.projected_stock));
    const raw = window.prompt(
      `Quantidade a comprar (${row.unit}) para ${row.ingredient_name}:`,
      suggested > 0 ? QTY.format(suggested) : "",
    );
    if (raw == null) return;
    const qty = parseQty(raw);
    if (qty == null) return toast.error("Quantidade inválida");
    setLists((prev) => {
      const existing = prev[kind].find((x) => x.ingredient_id === row.ingredient_id);
      const next = existing
        ? prev[kind].map((x) => x.ingredient_id === row.ingredient_id ? { ...x, qty, addedAt: new Date().toISOString() } : x)
        : [...prev[kind], { ingredient_id: row.ingredient_id, name: row.ingredient_name, unit: row.unit, qty, addedAt: new Date().toISOString() }];
      return { ...prev, [kind]: next };
    });
    const dest = kind === "emergency" ? "compras emergenciais" : "lista de encomendas";
    toast.success(`Adicionado à ${dest}`);
  }

  function updateItemQty(kind: "emergency" | "orders", ingredient_id: string, qty: number) {
    setLists((prev) => ({
      ...prev,
      [kind]: prev[kind].map((x) => x.ingredient_id === ingredient_id ? { ...x, qty } : x),
    }));
  }
  function removeItem(kind: "emergency" | "orders", ingredient_id: string) {
    setLists((prev) => ({ ...prev, [kind]: prev[kind].filter((x) => x.ingredient_id !== ingredient_id) }));
  }

  function buildMessage(title: string, items: ListItem[]) {
    const lines = [`*${title}* — ${formatBR(todayISO())}`, ""];
    for (const it of items) lines.push(`• ${it.name}: ${QTY.format(it.qty)} ${it.unit}`);
    lines.push("", `Total de itens: ${items.length}`);
    return lines.join("\n");
  }

  function openOrderDialog(row: ProjectedRow, fromList?: "emergency" | "orders") {
    setOrderTarget({
      row: {
        ingredient_id: row.ingredient_id,
        ingredient_name: row.ingredient_name,
        unit: row.unit,
        min_stock: row.min_stock,
        projected_stock: row.projected_stock,
      },
      fromList,
    });
  }
  function openOrderDialogFromList(it: ListItem) {
    setOrderTarget({
      row: {
        ingredient_id: it.ingredient_id,
        ingredient_name: it.name,
        unit: it.unit,
        min_stock: 0,
        projected_stock: 0,
      },
      fromList: "orders",
    });
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
              Insumos abaixo do mínimo (excluindo sub-receitas). Envie as vendas de um dia ou período
              para atualizar o consumo estimado.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setShowEmergency(true)}>
              <ClipboardList className="mr-1 h-4 w-4" />
              Compras emergenciais
              {lists.emergency.length > 0 && <Badge variant="secondary" className="ml-2">{lists.emergency.length}</Badge>}
            </Button>
            <Button variant="outline" onClick={() => setShowOrders(true)}>
              <ClipboardList className="mr-1 h-4 w-4" />
              Lista de encomendas
              {lists.orders.length > 0 && <Badge variant="secondary" className="ml-2">{lists.orders.length}</Badge>}
            </Button>
            <Button asChild variant="outline">
              <Link to="/purchases/orders"><PackageCheck className="mr-1 h-4 w-4" /> Encomendas</Link>
            </Button>
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
              <DialogTrigger asChild>
                <Button><Upload className="mr-1 h-4 w-4" /> Enviar vendas</Button>
              </DialogTrigger>
              <NewDailyReportDialog onDone={() => {
                setUploadOpen(false);
                qc.invalidateQueries({ queryKey: ["daily-sales-reports"] });
                qc.invalidateQueries({ queryKey: ["projected-stock-status"] });
              }} />
            </Dialog>
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
          <div className="rounded-lg border border-emerald-600/40 bg-emerald-50/40 p-6 text-sm text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Nenhum insumo em risco no momento.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard tone="destructive" label="Zerados" count={zeroed.length} desc="Estoque projetado ≤ 0" />
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
                  <TableHead className="text-right">Consumo estimado</TableHead>
                  <TableHead className="text-right">Projetado</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Dias</TableHead>
                  <TableHead></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertRows.map((r) => (
                  <TableRow key={r.ingredient_id} className="cursor-pointer hover:bg-secondary/40"
                    onClick={() => nav({ to: "/ingredients/$id", params: { id: r.ingredient_id } })}>
                    <TableCell className="font-medium">{r.ingredient_name}</TableCell>
                    <TableCell className="text-right">{QTY.format(Number(r.current_stock))} {r.unit}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      −{QTY.format(Number(r.consumed_since_anchor))} {r.unit}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${r.status === "zerado" || r.status === "abaixo_minimo" ? "text-destructive" : "text-amber-600"}`}>
                      {QTY.format(Number(r.projected_stock))} {r.unit}
                    </TableCell>
                    <TableCell className="text-right">{QTY.format(Number(r.min_stock))} {r.unit}</TableCell>
                    <TableCell className="text-right">{r.days_since_anchor}d</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm">Ações <ChevronDown className="ml-1 h-3 w-3" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Adicionar em…</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => addToList("emergency", r)}>
                            <ClipboardList className="mr-2 h-4 w-4" /> Compras emergenciais
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => addToList("orders", r)}>
                            <ClipboardList className="mr-2 h-4 w-4" /> Lista de encomendas
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => openOrderDialog(r)}>
                            <PackageCheck className="mr-2 h-4 w-4 text-emerald-600" /> Já encomendado
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Histórico */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Últimos envios</h2>
        <div className="rounded-xl border bg-card">
          {!reports || reports.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nenhum envio ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Arquivo</TableHead>
                  <TableHead className="text-right">Itens</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">Mapeados</TableHead>
                  <TableHead className="text-right">Sem código</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{formatBR(r.sales_date)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.file_name ?? "—"}</TableCell>
                    <TableCell className="text-right">{QTY.format(Number(r.total_quantity))}</TableCell>
                    <TableCell className="text-right">{BRL.format(Number(r.total_revenue))}</TableCell>
                    <TableCell className="text-right">{r.mapped_count}</TableCell>
                    <TableCell className="text-right">
                      {r.unmapped_count > 0 ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-600/40">{r.unmapped_count}</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => removeReport(r.id, formatBR(r.sales_date))}>
                        <Trash2 className="text-destructive h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {/* Diálogos das listas */}
      <ListDialog
        open={showEmergency}
        onClose={() => setShowEmergency(false)}
        title="Compras emergenciais"
        items={lists.emergency}
        onQtyChange={(id, q) => updateItemQty("emergency", id, q)}
        onRemove={(id) => removeItem("emergency", id)}
        onSend={() => setWaTarget({ title: "Compras emergenciais", message: buildMessage("Compras emergenciais", lists.emergency) })}
        onMarkOrdered={undefined}
      />
      <ListDialog
        open={showOrders}
        onClose={() => setShowOrders(false)}
        title="Lista de encomendas"
        items={lists.orders}
        onQtyChange={(id, q) => updateItemQty("orders", id, q)}
        onRemove={(id) => removeItem("orders", id)}
        onSend={() => setWaTarget({ title: "Lista de encomendas", message: buildMessage("Lista de encomendas", lists.orders) })}
        onMarkOrdered={(it) => openOrderDialogFromList(it)}
      />

      {/* WhatsApp picker */}
      <Dialog open={waTarget != null} onOpenChange={(o) => !o && setWaTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar por WhatsApp</DialogTitle>
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

      {/* "Já encomendado" — supplier / qty / expected */}
      <MarkOrderedDialog
        target={orderTarget}
        onClose={() => setOrderTarget(null)}
        onSaved={(ingId, fromList) => {
          if (fromList) removeItem(fromList, ingId);
          setOrderTarget(null);
          qc.invalidateQueries({ queryKey: ["purchase-orders-pending-ings"] });
          qc.invalidateQueries({ queryKey: ["purchase-orders"] });
        }}
      />
    </div>
  );
}

function ListDialog({
  open, onClose, title, items, onQtyChange, onRemove, onSend, onMarkOrdered,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  items: ListItem[];
  onQtyChange: (ingredient_id: string, qty: number) => void;
  onRemove: (ingredient_id: string) => void;
  onSend: () => void;
  onMarkOrdered?: (it: ListItem) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
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
                      <div className="flex justify-end gap-1">
                        {onMarkOrdered && (
                          <Button variant="outline" size="sm" onClick={() => onMarkOrdered(it)}>
                            <PackageCheck className="h-4 w-4 text-emerald-600" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => onRemove(it.ingredient_id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
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

function MarkOrderedDialog({
  target, onClose, onSaved,
}: {
  target: null | { row: { ingredient_id: string; ingredient_name: string; unit: string; min_stock: number; projected_stock: number }; fromList?: "emergency" | "orders" };
  onClose: () => void;
  onSaved: (ingredient_id: string, fromList?: "emergency" | "orders") => void;
}) {
  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierName, setSupplierName] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [expectedAt, setExpectedAt] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const { data: suppliers } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["suppliers-min"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id, name").order("name");
      return data ?? [];
    },
  });

  useEffect(() => {
    if (target) {
      const suggested = Math.max(0, Number(target.row.min_stock) - Number(target.row.projected_stock));
      setQty(suggested > 0 ? QTY.format(suggested) : "");
      setSupplierId("");
      setSupplierName("");
      setExpectedAt("");
      setNotes("");
    }
  }, [target]);

  async function save() {
    if (!target) return;
    const q = parseQty(qty);
    if (q == null) return toast.error("Quantidade inválida");
    if (!supplierId && !supplierName.trim()) return toast.error("Selecione ou informe um fornecedor");
    setSaving(true);
    const { data: prof } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!prof?.restaurant_id) { setSaving(false); return toast.error("Restaurante não encontrado"); }
    const chosen = suppliers?.find((s) => s.id === supplierId);
    const { error } = await (supabase as any).from("purchase_orders").insert({
      restaurant_id: prof.restaurant_id,
      supplier_id: supplierId || null,
      supplier_name: chosen?.name ?? (supplierName.trim() || null),
      ingredient_id: target.row.ingredient_id,
      quantity: q,
      unit: target.row.unit,
      expected_at: expectedAt || null,
      notes: notes.trim() || null,
      status: "pending",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Encomenda registrada");
    onSaved(target.row.ingredient_id, target.fromList);
  }

  return (
    <Dialog open={target != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Já encomendado — {target?.row.ingredient_name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label>Fornecedor</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Selecione um fornecedor" /></SelectTrigger>
              <SelectContent>
                {(suppliers ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Ou digite o nome do fornecedor"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>Quantidade ({target?.row.unit})</Label>
              <Input value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Previsão de chegada</Label>
              <Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Observação (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Registrar encomenda"}
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

// -------------------- Upload dialog --------------------

const HEADERS_CODE = ["codigo", "código", "cod", "sku", "produto_codigo", "product_code"];
const HEADERS_QTY = ["quantidade", "qtd", "qty", "quant", "vendas", "quantidade_vendida"];
const HEADERS_PRICE = ["preco", "preço", "preco_unitario", "preço_unitário", "valor", "valor_unitario", "unit_price"];

function norm(s: string) {
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
}
function colLetterToIndex(letter: string) {
  const s = letter.trim().toUpperCase();
  let n = 0;
  for (const ch of s) {
    if (ch < "A" || ch > "Z") return -1;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}
function parseNum(v: unknown) {
  if (v == null || v === "") return NaN;
  return Number(String(v).replace(/\./g, "").replace(",", "."));
}
function eachDate(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = fromISO.split("-").map(Number);
  const [ty, tm, td] = toISO.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return out;
}

function NewDailyReportDialog({ onDone }: { onDone: () => void }) {
  const [isRange, setIsRange] = useState(false);
  const [salesDate, setSalesDate] = useState(todayISO());
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [noHeader, setNoHeader] = useState(true);
  const [codeCol, setCodeCol] = useState("A");
  const [qtyCol, setQtyCol] = useState("B");
  const [priceCol, setPriceCol] = useState("");
  const create = useServerFn(createDailySalesReport);

  async function submit() {
    if (!file) return toast.error("Selecione um arquivo");
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      let rows: { product_code: string; quantity: number; unit_price: number | null }[] = [];
      if (noHeader) {
        const cIdx = colLetterToIndex(codeCol);
        const qIdx = colLetterToIndex(qtyCol);
        const pIdx = priceCol.trim() ? colLetterToIndex(priceCol) : -1;
        if (cIdx < 0 || qIdx < 0) throw new Error("Coluna inválida");
        const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
        rows = raw.map((r) => {
          const code = String(r[cIdx] ?? "").trim();
          const qty = parseNum(r[qIdx]);
          const price = pIdx >= 0 ? parseNum(r[pIdx]) : NaN;
          return {
            product_code: code,
            quantity: isFinite(qty) ? qty : 0,
            unit_price: isFinite(price) && price > 0 ? price : null,
          };
        }).filter((r) => r.product_code && r.quantity > 0);
      } else {
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (raw.length === 0) throw new Error("Planilha vazia");
        const keys = Object.keys(raw[0]);
        const normMap = new Map(keys.map((k) => [norm(k), k]));
        const codeKey = HEADERS_CODE.map((h) => normMap.get(h)).find(Boolean);
        const qtyKey = HEADERS_QTY.map((h) => normMap.get(h)).find(Boolean);
        const priceKey = HEADERS_PRICE.map((h) => normMap.get(h)).find(Boolean);
        if (!codeKey || !qtyKey) throw new Error("Precisa ter colunas de código e quantidade");
        rows = raw.map((r) => {
          const code = String(r[codeKey] ?? "").trim();
          const qty = parseNum(r[qtyKey]);
          const price = priceKey ? parseNum(r[priceKey]) : NaN;
          return {
            product_code: code,
            quantity: isFinite(qty) ? qty : 0,
            unit_price: isFinite(price) && price > 0 ? price : null,
          };
        }).filter((r) => r.product_code && r.quantity > 0);
      }
      if (rows.length === 0) throw new Error("Nenhuma linha válida na planilha");

      if (isRange) {
        if (dateTo < dateFrom) throw new Error("Data final anterior à inicial");
        const days = eachDate(dateFrom, dateTo);
        if (days.length === 0) throw new Error("Período inválido");
        // Split quantities across days
        const perDay = rows.map((r) => ({
          ...r,
          quantity: r.quantity / days.length,
        }));
        for (const d of days) {
          await create({ data: { sales_date: d, file_name: file.name, rows: perDay } });
        }
        toast.success(`Vendas gravadas em ${days.length} dia(s)`);
      } else {
        const res = await create({ data: { sales_date: salesDate, file_name: file.name, rows } });
        toast.success(`Dia gravado · ${res.mapped} produtos · ${res.ingredients} insumos${res.unmapped ? ` · ${res.unmapped} sem código` : ""}`);
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Enviar vendas</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isRange} onChange={(e) => setIsRange(e.target.checked)} />
          Enviar um período (várias datas)
        </label>
        {isRange ? (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>De</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={todayISO()} />
            </div>
            <div>
              <Label>Até</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} max={todayISO()} />
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              A quantidade total será dividida igualmente entre os dias do período.
            </p>
          </div>
        ) : (
          <div>
            <Label>Data das vendas</Label>
            <Input type="date" value={salesDate} onChange={(e) => setSalesDate(e.target.value)} max={todayISO()} />
            <p className="mt-1 text-xs text-muted-foreground">
              Enviar novamente esta data substitui os valores anteriores.
            </p>
          </div>
        )}
        <div>
          <Label>Planilha (.xlsx, .csv)</Label>
          <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={noHeader} onChange={(e) => setNoHeader(e.target.checked)} />
          Planilha sem cabeçalho (escolher colunas manualmente)
        </label>
        {noHeader ? (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Coluna do código</Label>
              <Input value={codeCol} onChange={(e) => setCodeCol(e.target.value.toUpperCase())} placeholder="A" />
            </div>
            <div>
              <Label className="text-xs">Coluna da quantidade</Label>
              <Input value={qtyCol} onChange={(e) => setQtyCol(e.target.value.toUpperCase())} placeholder="B" />
            </div>
            <div>
              <Label className="text-xs">Preço unit. (opcional)</Label>
              <Input value={priceCol} onChange={(e) => setPriceCol(e.target.value.toUpperCase())} placeholder="—" />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Colunas aceitas: <strong>código</strong> + <strong>quantidade</strong> (obrigatórias); preço opcional.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy}>{busy ? "Enviando..." : "Enviar"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
