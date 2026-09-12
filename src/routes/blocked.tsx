import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/blocked")({
  component: BlockedPage,
});

function BlockedPage() {
  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <h1 className="font-display text-2xl">Acesso suspenso</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        O acesso deste restaurante está temporariamente suspenso. Seus dados
        continuam guardados. Entre em contato com o suporte para regularizar
        o acesso.
      </p>
      <Button onClick={logout}>Sair</Button>
    </div>
  );
}
