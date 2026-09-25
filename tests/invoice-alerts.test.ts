import { describe, it, expect, vi, beforeEach } from "vitest";

const sendWebPush = vi.fn();
let subs: any[] = [];
let owners: any[] = [];
const deleted: string[] = [];

vi.mock("@/lib/web-push.server", () => ({
  PushSendError: class PushSendError extends Error {
    status: number;
    constructor(status: number) {
      super("x");
      this.status = status;
    }
  },
  sendWebPush: (...a: unknown[]) => sendWebPush(...a),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "push_subscriptions") {
        return {
          select: () => ({ eq: async () => ({ data: subs }) }),
          delete: () => ({ eq: async (_c: string, id: string) => { deleted.push(id); return {}; } }),
        };
      }
      return { select: () => ({ eq: () => ({ in: async () => ({ data: owners }) }) }) };
    },
  },
}));

import { notifyOwnersNewInvoice } from "@/lib/invoice-alerts.server";

const base = { restaurantId: "r1", senderUserId: "receiver", supplierName: "Ceasa", url: "/x" };
const sub = (id: string, by: string | null) => ({ id, endpoint: `e${id}`, p256dh: "p", auth: "a", created_by: by });

describe("notifyOwnersNewInvoice", () => {
  beforeEach(() => {
    sendWebPush.mockReset();
    deleted.length = 0;
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
  });

  it("envia só para aparelhos do dono, não para o remetente nem outros", async () => {
    subs = [sub("1", "owner"), sub("2", "manager"), sub("3", "receiver")];
    owners = [{ user_id: "owner" }];
    const r = await notifyOwnersNewInvoice(base);
    expect(r.sent).toBe(1);
    expect(sendWebPush).toHaveBeenCalledTimes(1);
    expect(sendWebPush.mock.calls[0][0].endpoint).toBe("e1");
  });

  it("não lança erro se o envio falhar", async () => {
    subs = [sub("1", "owner")];
    owners = [{ user_id: "owner" }];
    sendWebPush.mockRejectedValue(new Error("boom"));
    await expect(notifyOwnersNewInvoice(base)).resolves.toEqual({ sent: 0 });
  });

  it("não faz nada sem chaves VAPID", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    subs = [sub("1", "owner")];
    owners = [{ user_id: "owner" }];
    await expect(notifyOwnersNewInvoice(base)).resolves.toEqual({ sent: 0 });
    expect(sendWebPush).not.toHaveBeenCalled();
  });
});
