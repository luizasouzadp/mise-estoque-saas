import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { BellRing, BellOff } from "lucide-react";
import { toast } from "sonner";
import { subscribePush, unsubscribePush, sendTestPush } from "@/lib/push.functions";

function getVapidPublicKey(): string | null {
  const key = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || (process.env.VAPID_PUBLIC_KEY as string | undefined);
  return key || null;
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
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const subscribeFn = useServerFn(subscribePush);
  const unsubscribeFn = useServerFn(unsubscribePush);
  const testFn = useServerFn(sendTestPush);

  useEffect(() => {
    (async () => {
      const ok = "serviceWorker" in navigator && "PushManager" in window && !!getVapidPublicKey();
      setSupported(ok);
      if (!ok) return;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        setSubscribed(!!sub);
      } catch {
        // ignore — treated as not subscribed
      }
    })();
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const publicKey = getVapidPublicKey();
      if (!publicKey) throw new Error("Notificações não configuradas neste ambiente.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Permissão de notificação negada.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      await subscribeFn({
        data: {
          endpoint: json.endpoint!,
          p256dh: json.keys!.p256dh!,
          auth: json.keys!.auth!,
        },
      });
      setSubscribed(true);
      toast.success("Lembretes ativados neste dispositivo.");
    } catch (err) {
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
