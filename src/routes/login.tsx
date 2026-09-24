import { Logo } from "@/components/Logo";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { restrictedRoleOf, homePathForRole } from "@/lib/roles";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    next: typeof s.next === "string" && s.next.startsWith("/") ? s.next : undefined,
  }),

  beforeLoad: async ({ search }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    if (search.next) throw redirect({ href: search.next });
    const role = await restrictedRoleOf();
    throw redirect({ to: homePathForRole(role) });
  },

  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const { next } = Route.useSearch();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const id = identifier.trim();
    const email = id.includes("@") ? id : `${id.toLowerCase()}@chef.mise.local`;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Bem-vindo de volta!");
    if (next) {
      window.location.href = next;
      return;
    }
    const isChefLogin = !id.includes("@");
    nav({ to: isChefLogin ? "/productions" : "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <Logo size={44} />
        </Link>
        <div className="rounded-2xl border bg-card p-8 shadow-[var(--shadow-card)]">
          <h1 className="font-display text-2xl">Entrar</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use seu e-mail ou nome de usuário (chef).</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="identifier">E-mail ou usuário</Label>
              <Input id="identifier" type="text" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <p className="text-right text-sm">
              <Link to="/recuperar-senha" className="text-muted-foreground hover:underline">Esqueci minha senha</Link>
            </p>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
