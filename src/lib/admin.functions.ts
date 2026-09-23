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
      .select("id, name, status, internal_code")
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
    })) as { id: string; name: string; status: string; internal_code: string; ownerEmails: string[] }[];
  });

const ImpersonateRestaurantSchema = z.object({
  restaurantId: z.string().uuid(),
});

export const impersonateRestaurant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ImpersonateRestaurantSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensurePlatformAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("restaurant_id", data.restaurantId)
      .limit(1)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile) throw new Error("Nenhum usuário encontrado para este restaurante.");

    const { data: userRes, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.id);
    if (userError || !userRes.user?.email) throw new Error("Não foi possível localizar o e-mail deste usuário.");

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: userRes.user.email,
    });
    if (linkError) throw new Error(linkError.message);
    return { actionLink: linkData.properties.action_link };
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

const RenameRestaurantSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
});

export const renameRestaurant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RenameRestaurantSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await ensurePlatformAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("restaurants")
      .update({ name: data.name })
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
