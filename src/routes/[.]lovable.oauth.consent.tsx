import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type OAuthClient = { name?: string; client_name?: string };
type OAuthAuthorization = {
  client?: OAuthClient | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

// Beta API — declare a minimal typed wrapper so TS is happy without editing SDK types.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: OAuthAuthorization | null; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: OAuthAuthorization | null; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: OAuthAuthorization | null; error: any }>;
};

function oauthApi(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/login", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Não foi possível carregar a autorização</h1>
      <p className="mt-2 text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? details?.client?.client_name ?? "um aplicativo";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("O servidor de autorização não retornou um redirecionamento.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <div className="rounded-2xl border bg-card p-8 shadow-[var(--shadow-card)]">
        <h1 className="font-display text-2xl">Conectar {clientName} à sua conta</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Isso permite que <strong>{clientName}</strong> acesse os dados do seu restaurante no Mise em seu nome
          (consultar insumos, fichas técnicas e registrar movimentações).
        </p>
        {error && (
          <p role="alert" className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <Button onClick={() => decide(true)} disabled={busy} className="flex-1">
            {busy ? "Processando..." : "Aprovar"}
          </Button>
          <Button variant="outline" onClick={() => decide(false)} disabled={busy} className="flex-1">
            Recusar
          </Button>
        </div>
      </div>
    </main>
  );
}
