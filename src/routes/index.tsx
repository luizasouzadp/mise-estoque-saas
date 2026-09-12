import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChefHat, Package, Receipt, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ChefHat className="h-5 w-5" />
            </div>
            <span className="font-display text-xl">Mise</span>
          </div>
          <div className="flex gap-2">
            <Button asChild><Link to="/login">Entrar</Link></Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <h1 className="font-display text-5xl md:text-6xl leading-tight">
            Estoque sob controle, margem na ponta dos dedos.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Mise é o app de gestão de estoque feito para pequenos restaurantes e bares.
            Registre compras, controle insumos e acompanhe seu custo médio direto do celular.
          </p>
          <div className="mt-8 flex gap-3">
            <Button asChild size="lg"><Link to="/login">Entrar</Link></Button>
          </div>
        </div>

        <div className="mt-20 grid gap-6 md:grid-cols-3">
          {[
            { icon: Package, title: "Insumos no controle", desc: "Catálogo com unidade, estoque atual e custo médio sempre atualizados." },
            { icon: Receipt, title: "Compras rápidas", desc: "Registre a entrada e o estoque + custo médio são recalculados automaticamente." },
            { icon: TrendingUp, title: "Visão clara", desc: "Painel inicial com totais e alertas de estoque baixo." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
