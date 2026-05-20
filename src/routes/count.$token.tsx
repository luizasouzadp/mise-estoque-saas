import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getInventoryByToken, submitInventoryCount } from "@/lib/inventory.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ChefHat, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/count/$token")({ component: CountPage });

function CountPage() {
  const { token } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const fetchInv = useServerFn(getInventoryByToken);
  const submit = useServerFn(submitInventoryCount);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["count", token],
    queryFn: () => fetchInv({ data: { token } }),
    retry: false,
  });

  useEffect(() => {
    if (data?.items) {
      const init: Record<string, string> = {};
      for (const it of data.items) {
        init[it.id] = it.counted_qty != null ? String(it.counted_qty) : "";
      }
      setCounts(init);
    }
  }, [data]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = Object.entries(counts)
      .filter(([, v]) => v !== "" && !isNaN(Number(v)))
      .map(([itemId, v]) => ({ itemId, countedQty: Number(v) }));
    if (payload.length === 0) return toast.error("Preencha pelo menos um item");
    if (payload.length < (data?.items.length ?? 0)) {
      if (!confirm("Alguns itens não foram contados. Deseja finalizar mesmo assim?")) return;
    }
    setSaving(true);
    try {
      await submit({ data: { token, counts: payload } });
      toast.success("Contagem registrada! Estoque atualizado.");
      qc.invalidateQueries({ queryKey: ["count", token] });
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;
  if (error || !data) return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="font-display text-2xl">Inventário não encontrado</h1>
      <p className="mt-2 text-sm text-muted-foreground">O link pode ter expirado ou estar incorreto.</p>
    </div>
  );

  const done = data.status === "completed";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ChefHat className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{data.restaurantName}</div>
            <div className="font-display text-lg leading-none">Contagem — {data.groupName ?? "Todos os insumos"}</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl p-4 pb-32">
        {done && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border bg-primary/10 p-4 text-sm text-primary">
            <CheckCircle2 className="h-5 w-5" /> Esta contagem já foi finalizada.
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          {data.items.map((it) => (
            <div key={it.id} className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{it.ingredient_name}</div>
                  <div className="text-xs text-muted-foreground">
                    Sistema: {Number(it.expected_qty).toFixed(2)} {it.unit}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    className="w-28 text-right"
                    placeholder="0,00"
                    value={counts[it.id] ?? ""}
                    onChange={(e) => setCounts((c) => ({ ...c, [it.id]: e.target.value }))}
                    disabled={done}
                  />
                  <span className="text-xs text-muted-foreground w-8">{it.unit}</span>
                </div>
              </div>
            </div>
          ))}
          {!done && (
            <div className="fixed inset-x-0 bottom-0 border-t bg-card p-4">
              <div className="mx-auto max-w-2xl">
                <Button type="submit" size="lg" className="w-full" disabled={saving}>
                  {saving ? "Salvando..." : "Finalizar contagem"}
                </Button>
              </div>
            </div>
          )}
        </form>
      </main>
    </div>
  );
}
