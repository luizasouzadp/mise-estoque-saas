import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Images, ImageOff, Download, Loader2 } from "lucide-react";
import JSZip from "jszip";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/purchases/notes")({
  component: NotesArchive,
});

type NoteRow = {
  id: string;
  purchased_at: string;
  supplier: string | null;
  total_cost: number;
  invoice_image_path: string;
};

const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

function NotesArchive() {
  const { data, isLoading } = useQuery({
    queryKey: ["purchase-notes"],
    queryFn: async () => {
      const [purchasesRes, ordersRes] = await Promise.all([
        supabase
          .from("purchases")
          .select("id, purchased_at, supplier, total_cost, invoice_image_path")
          .not("invoice_image_path", "is", null)
          .order("purchased_at", { ascending: false }),
        (supabase as any)
          .from("purchase_orders")
          .select("id, received_at, supplier_name, receipt_image_path")
          .not("receipt_image_path", "is", null)
          .order("received_at", { ascending: false }),
      ]);
      if (purchasesRes.error) throw purchasesRes.error;
      if (ordersRes.error) throw ordersRes.error;

      const purchaseRows = (purchasesRes.data ?? []) as NoteRow[];
      // Paths already in `purchases` — dedupe orders that were already imported.
      const known = new Set(purchaseRows.map((p) => p.invoice_image_path));

      const orderRows: NoteRow[] = [];
      const seenOrderPath = new Set<string>();
      for (const o of (ordersRes.data ?? []) as Array<{
        id: string; received_at: string | null; supplier_name: string | null; receipt_image_path: string;
      }>) {
        if (known.has(o.receipt_image_path)) continue;
        if (seenOrderPath.has(o.receipt_image_path)) continue;
        seenOrderPath.add(o.receipt_image_path);
        orderRows.push({
          id: `order:${o.id}`,
          purchased_at: o.received_at ?? new Date().toISOString(),
          supplier: o.supplier_name,
          total_cost: 0,
          invoice_image_path: o.receipt_image_path,
        });
      }
      return [...purchaseRows, ...orderRows].sort((a, b) =>
        a.purchased_at < b.purchased_at ? 1 : -1,
      );
    },
  });

  // Group unique invoice paths by month (one purchase can share a note with multiple line items).
  const groups = useMemo(() => {
    if (!data) return [] as Array<{ key: string; label: string; notes: NoteRow[] }>;
    const seen = new Set<string>();
    const byMonth = new Map<string, { label: string; notes: NoteRow[] }>();
    for (const row of data) {
      if (seen.has(row.invoice_image_path)) continue;
      seen.add(row.invoice_image_path);
      const d = new Date(row.purchased_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = MONTH_LABEL.format(d).replace(/^./, (c) => c.toUpperCase());
      if (!byMonth.has(key)) byMonth.set(key, { label, notes: [] });
      byMonth.get(key)!.notes.push(row);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, v]) => ({ key, ...v }));
  }, [data]);

  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    const paths = Array.from(new Set(data.map((d) => d.invoice_image_path)));
    const missing = paths.filter((p) => !urls[p]);
    if (missing.length === 0) return;
    (async () => {
      const { data: signed } = await supabase.storage
        .from("purchase-invoices")
        .createSignedUrls(missing, 60 * 60);
      if (!signed) return;
      setUrls((prev) => {
        const next = { ...prev };
        signed.forEach((s, i) => {
          if (s.signedUrl) next[missing[i]] = s.signedUrl;
        });
        return next;
      });
    })();
  }, [data, urls]);

  const [preview, setPreview] = useState<NoteRow | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  async function exportMonth(g: { key: string; label: string; notes: NoteRow[] }) {
    setExporting(g.key);
    try {
      const zip = new JSZip();
      const folder = zip.folder(g.label) ?? zip;
      const used = new Map<string, number>();
      for (const n of g.notes) {
        const { data: blob, error } = await supabase.storage
          .from("purchase-invoices")
          .download(n.invoice_image_path);
        if (error || !blob) continue;
        const ext = n.invoice_image_path.split(".").pop()?.toLowerCase() || "jpg";
        const date = new Date(n.purchased_at).toISOString().slice(0, 10);
        const supplier = (n.supplier ?? "sem-fornecedor").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
        let base = `${date}_${supplier}`;
        const count = (used.get(base) ?? 0) + 1;
        used.set(base, count);
        if (count > 1) base = `${base}_${count}`;
        folder.file(`${base}.${ext}`, blob);
      }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `notas_${g.key}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`ZIP de ${g.label} gerado.`);
    } catch (e) {
      toast.error((e as Error).message || "Falha ao gerar ZIP");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <Link to="/purchases" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <h1 className="mt-3 font-display text-3xl">Notas fiscais</h1>
      <p className="text-sm text-muted-foreground">Arquivo das fotos das notas, agrupadas por mês.</p>

      <div className="mt-6 space-y-8">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed bg-card/50 p-12 text-center">
            <Images className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-4 font-semibold">Nenhuma nota arquivada</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              As fotos aparecem aqui quando você lança compras por foto da nota.
            </p>
            <Button asChild className="mt-4">
              <Link to="/purchases/import">Lançar por foto</Link>
            </Button>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key}>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="font-display text-xl">{g.label}</h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{g.notes.length} nota(s)</span>
                  <Button size="sm" variant="outline" onClick={() => exportMonth(g)} disabled={exporting === g.key}>
                    {exporting === g.key ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando…</>
                    ) : (
                      <><Download className="mr-2 h-4 w-4" /> Exportar ZIP</>
                    )}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {g.notes.map((n) => {
                  const url = urls[n.invoice_image_path];
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setPreview(n)}
                      className="group overflow-hidden rounded-xl border bg-card text-left shadow-[var(--shadow-soft)] transition hover:shadow-md"
                    >
                      <div className="aspect-square w-full bg-muted">
                        {url ? (
                          <img src={url} alt="Nota" className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <ImageOff className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <div className="p-2 text-xs">
                        <p className="truncate font-medium">{n.supplier ?? "Sem fornecedor"}</p>
                        <p className="text-muted-foreground">
                          {new Date(n.purchased_at).toLocaleDateString("pt-BR")}
                          {Number(n.total_cost) > 0 ? ` · R$ ${Number(n.total_cost).toFixed(2)}` : " · aguardando entrada"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {preview?.supplier ?? "Nota"} — {preview ? new Date(preview.purchased_at).toLocaleDateString("pt-BR") : ""}
            </DialogTitle>
          </DialogHeader>
          {preview && urls[preview.invoice_image_path] && (
            <img
              src={urls[preview.invoice_image_path]}
              alt="Nota ampliada"
              className="max-h-[75vh] w-full rounded-lg object-contain"
            />
          )}
          {preview && (
            <a
              href={urls[preview.invoice_image_path]}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground underline"
            >
              Abrir em nova aba
            </a>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
