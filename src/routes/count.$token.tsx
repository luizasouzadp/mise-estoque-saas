import { Logo } from "@/components/Logo";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getInventoryByToken, submitInventoryCount } from "@/lib/inventory.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, ArrowLeft, Circle } from "lucide-react";

export const Route = createFileRoute("/count/$token")({ component: CountPage });

function CountPage() {
  const { token } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const fetchInv = useServerFn(getInventoryByToken);
  const submit = useServerFn(submitInventoryCount);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

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

  function isFilled(itemId: string) {
    const raw = counts[itemId] ?? "";
    const parsed = raw.trim().replace(",", ".");
    return parsed !== "" && !isNaN(Number(parsed));
  }

  const groupProgress = useMemo(() => {
    const m = new Map<string, { done: number; total: number }>();
    for (const [name, items] of grouped) {
      m.set(name, { done: items.filter((it) => isFilled(it.id)).length, total: items.length });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, counts]);

  const allDone = grouped.length > 0 && grouped.every(([name]) => {
    const p = groupProgress.get(name);
    return p && p.done === p.total;
  });

  async function saveGroup(items: Item[]) {
    const payload = items
      .map((it) => [it.id, (counts[it.id] ?? "").trim().replace(",", ".")] as const)
      .filter(([, v]) => v !== "" && !isNaN(Number(v)))
      .map(([itemId, v]) => ({ itemId, countedQty: Number(v) }));
    if (payload.length === 0) return toast.error("Preencha pelo menos um item do grupo");
    setSaving(true);
    try {
      await submit({ data: { token, counts: payload } });
      toast.success("Grupo salvo");
      await qc.invalidateQueries({ queryKey: ["count", token] });
      setActiveGroup(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function finalize() {
    // Re-submit any remaining counts to guarantee persistence and mark finished
    const payload = (data?.items ?? [])
      .map((it) => [it.id, (counts[it.id] ?? "").trim().replace(",", ".")] as const)
      .filter(([, v]) => v !== "" && !isNaN(Number(v)))
      .map(([itemId, v]) => ({ itemId, countedQty: Number(v) }));
    setSaving(true);
    try {
      if (payload.length > 0) await submit({ data: { token, counts: payload } });
      toast.success("Contagem finalizada! Aguarde o administrador.");
      setFinished(true);
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao finalizar");
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

  const activeItems = activeGroup ? grouped.find(([n]) => n === activeGroup)?.[1] ?? [] : [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          {activeGroup && (
            <button onClick={() => setActiveGroup(null)} className="mr-1 rounded-md p-1 hover:bg-muted" aria-label="Voltar">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <Logo size={30} />
          <div>
            <div className="text-xs text-muted-foreground">{data.restaurantName}</div>
            <div className="font-display text-lg leading-none">
              {activeGroup ?? data.inventoryName}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl p-4 pb-32">
        {finished ? (
          <div className="mt-12 rounded-xl border bg-card p-8 text-center shadow-[var(--shadow-soft)]">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
            <h2 className="mt-3 font-display text-2xl">Contagem finalizada</h2>
            <p className="mt-2 text-sm text-muted-foreground">Obrigado! O administrador irá conferir e atualizar o estoque.</p>
          </div>
        ) : !activeGroup ? (
          <>
            <div className="mb-4 flex items-center gap-2 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" /> Selecione um grupo, preencha as quantidades e salve. Quando todos estiverem completos, finalize a contagem.
            </div>
            <div className="space-y-2">
              {grouped.map(([groupName, items]) => {
                const p = groupProgress.get(groupName) ?? { done: 0, total: items.length };
                const complete = p.done === p.total;
                return (
                  <button
                    key={groupName}
                    onClick={() => setActiveGroup(groupName)}
                    className={`flex w-full items-center justify-between rounded-xl border p-4 text-left shadow-[var(--shadow-soft)] transition-colors hover:bg-muted/40 ${
                      complete ? "border-primary/40 bg-primary/5" : "bg-card"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {complete ? (
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground" />
                      )}
                      <div>
                        <div className="font-semibold">{groupName}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.done} de {p.total} {p.total === 1 ? "item" : "itens"}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
            <div className="fixed inset-x-0 bottom-0 border-t bg-card p-4">
              <div className="mx-auto max-w-2xl">
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  disabled={!allDone || saving}
                  onClick={finalize}
                >
                  {saving ? "Finalizando..." : allDone ? "Finalizar contagem" : "Complete todos os grupos"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveGroup(activeItems);
            }}
            className="space-y-2"
          >
            {activeItems.map((it) => {
              const filled = isFilled(it.id);
              return (
                <div
                  key={it.id}
                  className={`rounded-xl border p-4 shadow-[var(--shadow-soft)] transition-colors ${
                    filled ? "bg-card" : "border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/5"
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
            <div className="fixed inset-x-0 bottom-0 border-t bg-card p-4">
              <div className="mx-auto flex max-w-2xl gap-2">
                <Button type="button" variant="outline" size="lg" onClick={() => setActiveGroup(null)}>
                  Voltar
                </Button>
                <Button type="submit" size="lg" className="flex-1" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar grupo"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
