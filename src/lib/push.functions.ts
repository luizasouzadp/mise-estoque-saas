import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export const getVapidPublicKey = createServerFn({ method: "GET" })
  .handler(async () => {
    return { publicKey: process.env.VAPID_PUBLIC_KEY ?? null };
  });

export const subscribePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SubscribeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase.from("profiles").select("restaurant_id").eq("id", userId).maybeSingle();
    if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        restaurant_id: prof.restaurant_id,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        created_by: userId,
      },
      { onConflict: "endpoint" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unsubscribePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnsubscribeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase.from("profiles").select("restaurant_id").eq("id", userId).maybeSingle();
    if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");

    const { sendTestNotification } = await import("@/lib/order-reminders.server");
    return sendTestNotification(prof.restaurant_id);
  });

// Chamada depois que uma nota é salva (encomenda recebida ou nota avulsa) para avisar o dono.
export const notifyNewInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        supplierName: z.string().max(120).nullable(),
        pendingInvoiceId: z.string().uuid().optional(),
        receiptPath: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase.from("profiles").select("restaurant_id").eq("id", userId).maybeSingle();
    if (!prof?.restaurant_id) return { sent: 0 };

    const params = new URLSearchParams();
    if (data.pendingInvoiceId) params.set("pendingInvoiceId", data.pendingInvoiceId);
    else if (data.receiptPath) params.set("fromOrderReceipt", data.receiptPath);
    const url = params.toString() ? `/purchases/import?${params}` : "/purchases";

    const { notifyOwnersNewInvoice } = await import("@/lib/invoice-alerts.server");
    return notifyOwnersNewInvoice({
      restaurantId: prof.restaurant_id,
      senderUserId: userId,
      supplierName: data.supplierName?.trim() || null,
      url,
    });
  });
