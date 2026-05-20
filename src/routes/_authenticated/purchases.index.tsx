import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, Receipt } from "lucide-react";

export const Route = createFileRoute("/_authenticated/purchases/")({
  component: PurchasesList,
});

function PurchasesList() {
  const { data, isLoading } = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, quantity, unit_cost, total_cost, supplier, purchased_at, ingredient:ingredients(name, unit)")
        .order("purchased_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Compras</h1>
          <p className="text-sm text-muted-foreground">Histórico de entradas de insumos.</p>
        </div>
        <Button asChild>
          <Link to="/purchases/new"><Plus className="mr-2 h-4 w-4" /> Nova compra</Link>
        </Button>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : !data || data.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed bg-card/50 p-12 text-center">
            <Receipt className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-4 font-semibold">Nenhuma compra registrada</h3>
            <p className="mt-1 text-sm text-muted-foreground">Registre sua primeira entrada para abastecer o estoque.</p>
            <Button asChild className="mt-4"><Link to="/purchases/new"><Plus className="mr-2 h-4 w-4" /> Nova compra</Link></Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-soft)]">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Data</th>
                  <th className="p-3">Insumo</th>
                  <th className="p-3">Qtd</th>
                  <th className="p-3 hidden sm:table-cell">Preço un.</th>
                  <th className="p-3">Total</th>
                  <th className="p-3 hidden md:table-cell">Fornecedor</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.map((p) => (
                  <tr key={p.id}>
                    <td className="p-3 text-muted-foreground">{new Date(p.purchased_at).toLocaleDateString("pt-BR")}</td>
                    <td className="p-3 font-medium">{p.ingredient?.name ?? "—"}</td>
                    <td className="p-3">{Number(p.quantity).toFixed(2)} {p.ingredient?.unit}</td>
                    <td className="p-3 hidden sm:table-cell">R$ {Number(p.unit_cost).toFixed(2)}</td>
                    <td className="p-3 font-semibold">R$ {Number(p.total_cost).toFixed(2)}</td>
                    <td className="p-3 hidden md:table-cell text-muted-foreground">{p.supplier ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
