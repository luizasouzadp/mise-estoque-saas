import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { finalizeInventory } from "@/lib/inventory.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Copy, MessageCircle, CheckCircle2, XCircle, Users, CheckCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/inventories/$id")({ component: InventoryDetail });

type SessionRow = {
  id: string;
  group_id: string | null;
  public_token: string;
  status: string;
  assigned_to: string | null;
  completed_at: string | null;
};

function InventoryDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const finalize = useServerFn(finalizeInventory);
  const [finalizing, setFinalizing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["inventory", id],
    queryFn: async () => {
      const { data: inv, error } = await supabase
        .from("inventories")
        .select("id, status, created_at, completed_at")
        .eq("id", id).single();
      if (error) throw error;

      const { data: sessions } = await supabase
        .from("inventory_sessions")
        .select("id, group_id, public_token, status, assigned_to, completed_at")
        .eq("inventory_id", id)
        .order("created_at");

      const { data: items } = await supabase
        .from("inventory_items")
        .select("id, session_id, ingredient_id, ingredient_name, unit, expected_qty, counted_qty")
        .eq("inventory_id", id)
        .order("ingredient_name");

      const groupIds = (sessions ?? []).map((s) => s.group_id).filter((x): x is string => !!x);
      const { data: groups } = groupIds.length
        ? await supabase.from("ingredient_groups").select("id, name").in("id", groupIds)
        : { data: [] };
      const gmap = new Map((groups ?? []).map((g) => [g.id, g.name]));

      return {
        inv,
        sessions: (sessions ?? []) as SessionRow[],
        items: items ?? [],
        groupName: (gid: string | null) => (gid ? (gmap.get(gid) ?? "Grupo") : "Todos os insumos"),
      };
    },
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando...</div>;

  // Compute per-ingredient totals (summing across sessions)
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

  const allCounted = data.sessions.length > 0 && data.sessions.every((s) => s.status === "completed");
  const anyCounted = data.sessions.some((s) => s.status === "completed");

  async function cancel() {
    const { error } = await supabase.from("inventories").update({ status: "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Inventário cancelado");
    qc.invalidateQueries({ queryKey: ["inventory", id] });
    qc.invalidateQueries({ queryKey: ["inventories"] });
    nav({ to: "/inventories" });
  }

  async function handleFinalize() {
    if (!allCounted && !confirm("Algumas sessões ainda não foram contadas. Finalizar mesmo assim?")) return;
    setFinalizing(true);
    try {
      await finalize({ data: { inventoryId: id } });
      toast.success("Inventário finalizado e estoque atualizado");
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
          <h1 className="font-display text-3xl">Inventário</h1>
          <p className="text-sm text-muted-foreground">
            Criado em {new Date(data.inv.created_at).toLocaleString("pt-BR")}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${
          data.inv.status === "completed" ? "bg-primary/15 text-primary" :
          data.inv.status === "cancelled" ? "bg-muted text-muted-foreground" :
          "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]"
        }`}>
          {data.inv.status === "completed" ? "Finalizado" : data.inv.status === "cancelled" ? "Cancelado" : "Em aberto"}
        </span>
      </div>

      <h2 className="mt-6 font-semibold">Sessões de contagem</h2>
      <p className="text-xs text-muted-foreground">Cada grupo tem seu próprio link. Compartilhe com o responsável.</p>
      <div className="mt-3 space-y-3">
        {data.sessions.map((s) => (
          <SessionCard key={s.id} session={s} groupName={data.groupName(s.group_id)} canEdit={data.inv.status === "pending"} />
        ))}
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

      {data.inv.status === "pending" && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" className="text-destructive" onClick={cancel}>
            <XCircle className="mr-2 h-4 w-4" /> Cancelar inventário
          </Button>
          <Button onClick={handleFinalize} disabled={finalizing || !anyCounted}>
            <CheckCheck className="mr-2 h-4 w-4" />
            {finalizing ? "Finalizando..." : "Finalizar e atualizar estoque"}
          </Button>
        </div>
      )}
      {data.inv.status === "completed" && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border bg-primary/10 p-4 text-sm text-primary">
          <CheckCircle2 className="h-5 w-5" /> Estoque atualizado com a soma das contagens.
        </div>
      )}
    </div>
  );
}

function SessionCard({ session, groupName, canEdit }: { session: SessionRow; groupName: string; canEdit: boolean }) {
  const [phone, setPhone] = useState("");
  const link = typeof window !== "undefined" ? `${window.location.origin}/count/${session.public_token}` : `/count/${session.public_token}`;
  const message = `Olá! Hora de contar o estoque (${groupName}). Use o link: ${link}`;
  const cleanPhone = phone.replace(/\D/g, "");
  const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    toast.success("Link copiado");
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="font-semibold">{groupName}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          session.status === "completed"
            ? "bg-primary/15 text-primary"
            : "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]"
        }`}>
          {session.status === "completed" ? "Contado" : "Aguardando"}
        </span>
      </div>
      {canEdit && session.status !== "completed" && (
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
      )}
    </div>
  );
}
