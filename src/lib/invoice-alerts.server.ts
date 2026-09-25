import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PushSendError, sendWebPush } from "@/lib/web-push.server";

// Avisa o(s) dono(s) do restaurante que chegou uma nota aguardando entrada.
// Nunca lança erro: o aviso é um extra e não pode atrapalhar o envio da nota.
export async function notifyOwnersNewInvoice(opts: {
  restaurantId: string;
  senderUserId: string;
  supplierName: string | null;
  url: string;
}): Promise<{ sent: number }> {
  try {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return { sent: 0 };
    const vapid = { publicKey, privateKey, subjectMailto: "mailto:suporte@mise-estoque.app" };

    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, created_by")
      .eq("restaurant_id", opts.restaurantId);
    const candidates = (subs ?? []).filter((s) => s.created_by && s.created_by !== opts.senderUserId);
    if (candidates.length === 0) return { sent: 0 };

    const { data: owners } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "owner")
      .in("user_id", Array.from(new Set(candidates.map((s) => s.created_by as string))));
    const ownerIds = new Set((owners ?? []).map((o) => o.user_id));
    const targets = candidates.filter((s) => ownerIds.has(s.created_by as string));

    const body = opts.supplierName
      ? `Nova nota de ${opts.supplierName} aguardando entrada`
      : "Nova nota aguardando entrada";

    let sent = 0;
    for (const sub of targets) {
      try {
        await sendWebPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          { title: "Nota aguardando entrada", body, url: opts.url },
          vapid,
        );
        sent++;
      } catch (err) {
        if (err instanceof PushSendError && (err.status === 404 || err.status === 410)) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("[invoice-alerts] falha ao enviar push", err);
        }
      }
    }
    return { sent };
  } catch (err) {
    console.error("[invoice-alerts] erro inesperado", err);
    return { sent: 0 };
  }
}
