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
    const { data, error } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, status")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as { id: string; name: string; status: string }[];
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
      .update({ status: data.status } as never)
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
