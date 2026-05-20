import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { finalizeInventory } from "@/lib/inventory.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Copy, MessageCircle, CheckCircle2, Trash2, CheckCheck } from "lucide-react";

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

  const { data, isLoading } = useQuery({
    queryKey: ["inventory", id],
    queryFn: async () => {
      const { data: inv, error } = await supabase
        .from("inventories")
        .select("id, name, status, created_at, last_completed_at, frequency, weekday, public_token")
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

      return { inv, items: items ?? [], groups: groups ?? [] };
    },
  });

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
            {data.inv.last_completed_at && <> · última contagem em {new Date(data.inv.last_completed_at).toLocaleDateString("pt-BR")}</>}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${
          st.tone === "ok" ? "bg-primary/15 text-primary" :
          st.tone === "late" ? "bg-destructive/15 text-destructive" :
          "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]"
        }`}>{st.label}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {data.groups.map((g) => (
          <span key={g.id} className="rounded-full bg-muted px-3 py-1 text-xs">{g.name}</span>
        ))}
      </div>

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
