import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CreateChefSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, "Apenas letras, números, _ . -"),
  password: z.string().min(6).max(100),
});

const ChefIdSchema = z.object({ chefId: z.string().uuid() });
const ResetPwdSchema = z.object({ chefId: z.string().uuid(), password: z.string().min(6).max(100) });

async function ensureManager(supabase: any, userId: string) {
  const { data: isMgr } = await supabase.rpc("is_manager_or_owner", { _user_id: userId });
  if (!isMgr) throw new Error("Sem permissão");
  const { data: prof } = await supabase.from("profiles").select("restaurant_id").eq("id", userId).maybeSingle();
  if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");
  return prof.restaurant_id as string;
}

export const createChef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateChefSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const restaurantId = await ensureManager(supabase, userId);

    const email = `${data.username.toLowerCase()}@chef.mise.local`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.username, restaurant_name: "chef" },
    });
    if (cErr || !created.user) throw new Error(cErr?.message ?? "Erro ao criar chef");

    const chefId = created.user.id;

    await supabaseAdmin.from("profiles").update({ restaurant_id: restaurantId, full_name: data.username }).eq("id", chefId);

    await supabaseAdmin.from("user_roles").delete().eq("user_id", chefId);
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: chefId, role: "chef" });
    if (rErr) throw new Error(rErr.message);

    return { ok: true, username: data.username, email };
  });

export const listChefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const restaurantId = await ensureManager(supabase, userId);

    // Find chef user_ids
    const { data: chefRoles, error: rErr } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "chef");
    if (rErr) throw new Error(rErr.message);
    const chefIds = (chefRoles ?? []).map((r: any) => r.user_id);
    if (chefIds.length === 0) return [] as { id: string; username: string; email: string }[];

    // Filter to those in the same restaurant
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, full_name, restaurant_id")
      .in("id", chefIds)
      .eq("restaurant_id", restaurantId);
    if (pErr) throw new Error(pErr.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const out: { id: string; username: string; email: string }[] = [];
    for (const p of profs ?? []) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(p.id);
      out.push({ id: p.id, username: p.full_name ?? "", email: u?.user?.email ?? "" });
    }
    return out;
  });

export const deleteChef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ChefIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const restaurantId = await ensureManager(supabase, userId);

    // Verify target is a chef in same restaurant
    const { data: prof } = await supabase
      .from("profiles")
      .select("id, restaurant_id")
      .eq("id", data.chefId)
      .maybeSingle();
    if (!prof || prof.restaurant_id !== restaurantId) throw new Error("Chef não encontrado");

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.chefId);
    if (!roles?.some((r: any) => r.role === "chef")) throw new Error("Usuário não é chef");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.chefId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetChefPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ResetPwdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const restaurantId = await ensureManager(supabase, userId);

    const { data: prof } = await supabase
      .from("profiles")
      .select("id, restaurant_id")
      .eq("id", data.chefId)
      .maybeSingle();
    if (!prof || prof.restaurant_id !== restaurantId) throw new Error("Chef não encontrado");

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.chefId);
    if (!roles?.some((r: any) => r.role === "chef")) throw new Error("Usuário não é chef");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.chefId, { password: data.password });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
