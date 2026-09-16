import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PushSendError, sendWebPush } from "@/lib/web-push.server";

function todayWeekdayInSaoPaulo(): number {
  // Brazil has had no DST since 2019, so a fixed UTC-3 offset is safe here.
  const now = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return now.getUTCDay(); // 0 = Sunday ... 6 = Saturday, matching suppliers.order_days
}

function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subjectMailto: "mailto:suporte@mise-estoque.app" };
}

async function notifyRestaurant(restaurantId: string, supplierNames: string[]) {
  const vapid = getVapidConfig();
  if (!vapid) {
    console.error("[order-reminders] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configurados");
    return;
  }

  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("restaurant_id", restaurantId);
  if (!subs || subs.length === 0) return;

  const body = supplierNames.length === 1
    ? `Hoje é dia de pedido: ${supplierNames[0]}`
    : `Hoje é dia de pedido para: ${supplierNames.join(", ")}`;

  for (const sub of subs) {
    try {
      await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title: "Lembrete de pedido", body, url: "/purchases/shopping-list" },
        vapid,
      );
    } catch (err) {
      if (err instanceof PushSendError && (err.status === 404 || err.status === 410)) {
        await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error("[order-reminders] falha ao enviar push", err);
      }
    }
  }
}

export async function sendTestNotification(restaurantId: string): Promise<{ sent: number }> {
  const vapid = getVapidConfig();
  if (!vapid) throw new Error("Notificações não configuradas no servidor (faltam as chaves VAPID).");

  const { data: subs, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("restaurant_id", restaurantId);
  if (error) throw new Error(error.message);
  if (!subs || subs.length === 0) throw new Error("Nenhum dispositivo com lembretes ativados ainda.");

  let sent = 0;
  for (const sub of subs) {
    try {
      await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title: "Mise Estoque", body: "Notificação de teste — os lembretes estão funcionando! 🎉", url: "/suppliers" },
        vapid,
      );
      sent++;
    } catch (err) {
      if (err instanceof PushSendError && (err.status === 404 || err.status === 410)) {
        await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        throw err;
      }
    }
  }
  return { sent };
}

export async function runOrderDayReminders(): Promise<{ restaurantsNotified: number }> {
  const weekday = todayWeekdayInSaoPaulo();

  const { data: suppliers, error } = await supabaseAdmin
    .from("suppliers")
    .select("restaurant_id, name, order_days, notify_on_order_day")
    .eq("notify_on_order_day", true);
  if (error) throw new Error(error.message);

  const dueByRestaurant = new Map<string, string[]>();
  for (const s of suppliers ?? []) {
    if (!Array.isArray(s.order_days) || !s.order_days.includes(weekday)) continue;
    const list = dueByRestaurant.get(s.restaurant_id) ?? [];
    list.push(s.name);
    dueByRestaurant.set(s.restaurant_id, list);
  }

  for (const [restaurantId, names] of dueByRestaurant) {
    await notifyRestaurant(restaurantId, names);
  }

  return { restaurantsNotified: dueByRestaurant.size };
}
