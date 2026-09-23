import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function ensurePlatformAdmin(supabase: any, userId: string) {
  const { data: prof } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", userId)
    .maybeSingle();
  if (!prof?.is_platform_admin) throw new Error("Sem permissão");
}

export const listRestaurants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensurePlatformAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: restaurants, error } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, status")
      .order("name");
    if (error) throw new Error(error.message);

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, restaurant_id");
    if (profilesError) throw new Error(profilesError.message);

    const emailByUserId = new Map<string, string>();
    let page = 1;
    while (true) {
      const { data: usersPage, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (usersError) throw new Error(usersError.message);
      for (const u of usersPage.users) if (u.email) emailByUserId.set(u.id, u.email);
      if (usersPage.users.length < 200) break;
      page += 1;
    }

    const emailsByRestaurantId = new Map<string, string[]>();
    for (const p of profiles ?? []) {
      const email = emailByUserId.get(p.id);
      if (!email) continue;
      const list = emailsByRestaurantId.get(p.restaurant_id) ?? [];
      list.push(email);
      emailsByRestaurantId.set(p.restaurant_id, list);
    }

    return (restaurants ?? []).map((r) => ({
      ...r,
      ownerEmails: emailsByRestaurantId.get(r.id) ?? [],
    })) as { id: string; name: string; status: string; ownerEmails: string[] }[];
  });

const SetStatusSchema = z.object({
  restaurantId: z.string().uuid(),
  status: z.enum(["ativo", "bloqueado"]),
});

export const setRestaurantStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetStatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensurePlatformAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("restaurants")
      .update({ status: data.status })
      .eq("id", data.restaurantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const CreateRestaurantSchema = z.object({
  restaurantName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(6).max(100),
});

export const createRestaurantClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateRestaurantSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensurePlatformAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.ownerName, restaurant_name: data.restaurantName },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Erro ao criar restaurante");
    return { ok: true, ownerId: created.user.id };
  });
