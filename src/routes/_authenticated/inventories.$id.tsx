import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft, Copy, MessageCircle, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/inventories/$id")({ component: InventoryDetail });

function InventoryDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["inventory", id],
    queryFn: async () => {
      const { data: inv, error } = await supabase
        .from("inventories")
        .select("id, status, scheduled_for, created_at, completed_at, group_id, public_token")
        .eq("id", id).single();
      if (error) throw error;
      const { data: items } = await supabase
        .from("inventory_items")
        .select("id, ingredient_name, unit, expected_qty, counted_qty")
        .eq("inventory_id", id)
        .order("ingredient_name");
      const group = inv.group_id
        ? (await supabase.from("ingredient_groups").select("name").eq("id", inv.group_id).maybeSingle()).data
        : null;
      return { inv, items: items ?? [], groupName: group?.name ?? null };
    },
  });

  if (isLoading || !data) return <div className="p-8 text-muted-foreground">Carregando...</div>;

  const link = typeof window !== "undefined"
    ? `${window.location.origin}/count/${data.inv.public_token}`
    : `/count/${data.inv.public_token}`;

  const message = `Olá! Hora do inventário${data.groupName ? ` (${data.groupName})` : ""}. Conte os insumos por aqui: ${link}`;
  const cleanPhone = phone.replace(/\D/g, "");
  const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

  async function copyLink() {
    await navigator.clipboard.writeText(link);
    toast.success("Link copiado");
  }

  async function cancel() {
    const { error } = await supabase.from("inventories").update({ status: "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Inventário cancelado");
    qc.invalidateQueries({ queryKey: ["inventory", id] });
    qc.invalidateQueries({ queryKey: ["inventories"] });
    nav({ to: "/inventories" });
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link to="/inventories" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{data.groupName ?? "Todos os insumos"}</h1>
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

      {data.inv.status === "pending" && (
        <div className="mt-6 space-y-4 rounded-xl border bg-card p-5 shadow-[var(--shadow-soft)]">
          <div>
            <h2 className="font-semibold">Link público de contagem</h2>
            <p className="text-xs text-muted-foreground">Qualquer pessoa com este link pode registrar a contagem.</p>
          </div>
          <div className="flex gap-2">
            <input readOnly value={link} className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm" />
            <Button variant="outline" onClick={copyLink}><Copy className="mr-2 h-4 w-4" />Copiar</Button>
          </div>
          <div>
            <label className="text-sm font-medium">Enviar via WhatsApp</label>
            <div className="mt-2 flex gap-2">
              <input
                placeholder="Telefone com DDI (ex: 5511999998888)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              />
              <Button asChild disabled={cleanPhone.length < 10}>
                <a href={waLink} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="mr-2 h-4 w-4" /> Abrir WhatsApp
                </a>
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6">
        <h2 className="font-semibold">Itens ({data.items.length})</h2>
        <div className="mt-2 divide-y rounded-xl border bg-card shadow-[var(--shadow-soft)]">
          {data.items.map((it) => {
            const counted = it.counted_qty != null ? Number(it.counted_qty) : null;
            const expected = Number(it.expected_qty);
            const diff = counted != null ? counted - expected : null;
            return (
              <div key={it.id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <div className="text-sm font-medium">{it.ingredient_name}</div>
                  <div className="text-xs text-muted-foreground">esperado: {expected.toFixed(2)} {it.unit}</div>
                </div>
                <div className="text-right text-sm">
                  {counted != null ? (
                    <>
                      <div className="font-display text-lg">{counted.toFixed(2)} {it.unit}</div>
                      <div className={`text-xs ${diff! < 0 ? "text-destructive" : diff! > 0 ? "text-primary" : "text-muted-foreground"}`}>
                        {diff! > 0 ? "+" : ""}{diff!.toFixed(2)}
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">aguardando</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {data.inv.status === "pending" && (
        <div className="mt-6 flex justify-end">
          <Button variant="ghost" className="text-destructive" onClick={cancel}>
            <XCircle className="mr-2 h-4 w-4" /> Cancelar inventário
          </Button>
        </div>
      )}
      {data.inv.status === "completed" && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border bg-primary/10 p-4 text-sm text-primary">
          <CheckCircle2 className="h-5 w-5" /> Estoque atualizado com os valores contados.
        </div>
      )}
    </div>
  );
}
