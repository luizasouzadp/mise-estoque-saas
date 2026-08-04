import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "mise:install-dismissed";

export function InstallAppPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari) setShowIosHint(true);

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function close() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    close();
  }

  if (dismissed) return null;
  if (!deferred && !showIosHint) return null;

  return (
    <div className="fixed inset-x-3 bottom-24 z-[60] rounded-xl border bg-card p-4 shadow-[var(--shadow-card)] md:inset-x-auto md:right-6 md:bottom-6 md:w-96">
      <button
        onClick={close}
        aria-label="Fechar"
        className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Download className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Instalar o Mise no celular</h3>
          {deferred ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                Adicione o app à tela inicial para abrir mais rápido, como um app nativo.
              </p>
              <Button size="sm" className="mt-3" onClick={install}>
                Instalar app
              </Button>
            </>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              No iPhone: toque em <Share className="inline h-3 w-3" /> Compartilhar e depois em{" "}
              <strong>Adicionar à Tela de Início</strong>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
