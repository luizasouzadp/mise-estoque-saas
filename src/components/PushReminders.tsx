import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { BellRing, BellOff } from "lucide-react";
import { toast } from "sonner";
import { subscribePush, unsubscribePush, sendTestPush, getVapidPublicKey } from "@/lib/push.functions";

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function isIosNotStandalone(): boolean {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function PushReminders() {
  const [supported, setSupported] = useState(false);
  const [needsIosInstall, setNeedsIosInstall] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const subscribeFn = useServerFn(subscribePush);
  const unsubscribeFn = useServerFn(unsubscribePush);
  const testFn = useServerFn(sendTestPush);
  const vapidFn = useServerFn(getVapidPublicKey);

  useEffect(() => {
    (async () => {
      if (isIosNotStandalone()) {
        setNeedsIosInstall(true);
        setSupported(false);
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setSupported(false);
        return;
      }
      const { publicKey } = await vapidFn();
      setVapidKey(publicKey);
      setSupported(!!publicKey);
      if (!publicKey) return;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        setSubscribed(!!sub);
      } catch {
        // ignore — treated as not subscribed
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const publicKey = vapidKey;
      if (!publicKey) throw new Error("Notificações não configuradas neste ambiente.");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Permissão de notificação negada.");

      const reg = await withTimeout(
        navigator.serviceWorker.ready,
        10000,
        "O app não preparou o service worker a tempo. Recarregue a página (F5) e tente de novo.",
      );

      let sub: PushSubscription;
      try {
        sub = await withTimeout(
          reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
          }),
          10000,
          "O navegador demorou demais para responder. Tente de novo.",
        );
      } catch (subErr) {
        console.error("[push] subscribe falhou", subErr);
        throw new Error(`Falha ao criar a inscrição de notificação: ${subErr instanceof Error ? subErr.message : String(subErr)}`);
      }

      const json = sub.toJSON();
      try {
        await withTimeout(
          subscribeFn({
            data: {
              endpoint: json.endpoint!,
              p256dh: json.keys!.p256dh!,
              auth: json.keys!.auth!,
            },
          }),
          10000,
          "O servidor demorou demais para responder ao salvar a inscrição.",
        );
      } catch (saveErr) {
        console.error("[push] salvar inscrição falhou", saveErr);
        throw new Error(`Falha ao salvar a inscrição no servidor: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`);
      }

      setSubscribed(true);
      toast.success("Lembretes ativados neste dispositivo.");
    } catch (err) {
      console.error("[push] enable falhou", err);
      toast.error(err instanceof Error ? err.message : "Não foi possível ativar os lembretes.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribeFn({ data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Lembretes desativados neste dispositivo.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível desativar.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    try {
      const res = await testFn();
      toast.success(`Notificação de teste enviada (${res.sent} dispositivo${res.sent === 1 ? "" : "s"}).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar teste.");
    } finally {
      setBusy(false);
    }
  }

  if (needsIosInstall) {
    return (
      <div className="rounded-lg border bg-muted/20 p-3 text-sm">
        <p className="font-medium">Lembrete de dia de pedido</p>
        <p className="mt-1 text-xs text-muted-foreground">
          No iPhone, o Safari só permite notificações se o site for adicionado à tela de início primeiro:
          toque no ícone de compartilhar e depois em "Adicionar à Tela de Início". Depois, abra o app por esse
          ícone (não pelo Safari normal) para ativar os lembretes.
        </p>
      </div>
    );
  }

  if (!supported) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="text-sm">
        <p className="font-medium">Lembrete de dia de pedido</p>
        <p className="text-xs text-muted-foreground">
          Ativa um aviso neste navegador nos dias marcados para pedir de cada fornecedor.
        </p>
      </div>
      <div className="flex gap-2">
        {subscribed && (
          <Button type="button" variant="ghost" size="sm" onClick={sendTest} disabled={busy}>
            Testar
          </Button>
        )}
        {subscribed ? (
          <Button type="button" variant="outline" size="sm" onClick={disable} disabled={busy}>
            <BellOff className="mr-1 h-4 w-4" /> Desativar
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={enable} disabled={busy}>
            <BellRing className="mr-1 h-4 w-4" /> Ativar
          </Button>
        )}
      </div>
    </div>
  );
}
