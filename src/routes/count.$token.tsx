import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
      for (const it of data.items) init[it.id] = it.counted_qty != null ? String(it.counted_qty) : "";
      setCounts(init);
    }
  }, [data]);

  type Item = NonNullable<typeof data>["items"][number];
  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of data?.items ?? []) {
      if (!map.has(it.groupName)) map.set(it.groupName, []);
      map.get(it.groupName)!.push(it);
    }
    return Array.from(map.entries());
  }, [data]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = Object.entries(counts)
      .map(([itemId, v]) => [itemId, v.trim().replace(",", ".")] as const)
      .filter(([, v]) => v !== "" && !isNaN(Number(v)))
      .map(([itemId, v]) => ({ itemId, countedQty: Number(v) }));
    if (payload.length === 0) return toast.error("Preencha pelo menos um item");
    setSaving(true);
    try {
      await submit({ data: { token, counts: payload } });
      toast.success("Contagem enviada! Aguarde o administrador finalizar o inventário.");
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
      <p className="mt-2 text-sm text-muted-foreground">O link pode estar incorreto.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ChefHat className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{data.restaurantName}</div>
            <div className="font-display text-lg leading-none">{data.inventoryName}</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl p-4 pb-32">
        <div className="mb-4 flex items-center gap-2 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4" /> Quando um insumo aparece em vários grupos, registre a contagem em cada um. O sistema soma os valores.
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          {grouped.map(([groupName, items]) => (
            <section key={groupName} className="space-y-2">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">{groupName}</h2>
              {items.map((it) => {
                const raw = counts[it.id] ?? "";
                const parsed = raw.trim().replace(",", ".");
                const filled = parsed !== "" && !isNaN(Number(parsed));
                return (
                <div
                  key={it.id}
                  className={`rounded-xl border p-4 shadow-[var(--shadow-soft)] transition-colors ${
                    filled
                      ? "bg-card"
                      : "border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        {it.ingredient_name}
                        {!filled && (
                          <span className="rounded-full bg-[color:var(--color-warning)]/15 px-2 py-0.5 text-[10px] font-medium text-[color:var(--color-warning)]">
                            pendente
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Sistema: {Number(it.expected_qty).toFixed(2)} {it.unit}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text" inputMode="decimal"
                        className="w-28 text-right" placeholder="0,00"
                        value={counts[it.id] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.,]/g, "");
                          setCounts((c) => ({ ...c, [it.id]: v }));
                        }}
                      />
                      <span className="text-xs text-muted-foreground w-8">{it.unit}</span>
                    </div>
                  </div>
                </div>
                );
              })}
            </section>
          ))}
          <div className="fixed inset-x-0 bottom-0 border-t bg-card p-4">
            <div className="mx-auto max-w-2xl">
              <Button type="submit" size="lg" className="w-full" disabled={saving}>
                {saving ? "Salvando..." : "Enviar contagem"}
              </Button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
