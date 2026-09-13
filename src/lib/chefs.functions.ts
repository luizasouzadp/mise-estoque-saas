import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RoleSchema = z.enum(["chef", "receiver"]).default("chef");

const CreateChefSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, "Apenas letras, números, _ . -"),
  password: z.string().min(6).max(100),
  role: RoleSchema,
});

const ChefIdSchema = z.object({ chefId: z.string().uuid(), role: RoleSchema });
const ListSchema = z.object({ role: RoleSchema });
const ResetPwdSchema = z.object({
  chefId: z.string().uuid(),
  password: z.string().min(6).max(100),
  role: RoleSchema,
});

async function ensureManager(supabase: any, userId: string) {
  const { data: isMgr } = await supabase.rpc("is_manager_or_owner", { _user_id: userId });
  if (!isMgr) throw new Error("Sem permissão");
  const { data: prof } = await supabase.from("profiles").select("restaurant_id").eq("id", userId).maybeSingle();
  if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");
  return prof.restaurant_id as string;
}

function label(role: "chef" | "receiver") {
  return role === "chef" ? "Usuário de cozinha" : "Usuário de recebimento";
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
      user_metadata: { full_name: data.username, restaurant_name: data.role },
    });
    if (cErr || !created.user) throw new Error(cErr?.message ?? `Erro ao criar ${label(data.role).toLowerCase()}`);

    const chefId = created.user.id;

    await supabaseAdmin.from("profiles").update({ restaurant_id: restaurantId, full_name: data.username }).eq("id", chefId);

    await supabaseAdmin.from("user_roles").delete().eq("user_id", chefId);
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: chefId, role: data.role });
    if (rErr) throw new Error(rErr.message);

    return { ok: true, username: data.username, email };
  });

export const listChefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const restaurantId = await ensureManager(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: chefRoles, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", data.role);
    if (rErr) throw new Error(rErr.message);
    const chefIds = (chefRoles ?? []).map((r: any) => r.user_id);
    if (chefIds.length === 0) return [] as { id: string; username: string; email: string }[];

    const { data: profs, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, restaurant_id")
      .in("id", chefIds)
      .eq("restaurant_id", restaurantId);
    if (pErr) throw new Error(pErr.message);

    const out: { id: string; username: string; email: string }[] = [];
    for (const p of profs ?? []) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(p.id);
      out.push({ id: p.id, username: p.full_name ?? "", email: u?.user?.email ?? "" });
    }
    return out;
  });

async function assertTarget(supabase: any, restaurantId: string, targetId: string, role: "chef" | "receiver") {
  const { data: prof } = await supabase
    .from("profiles")
    .select("id, restaurant_id")
    .eq("id", targetId)
    .maybeSingle();
  if (!prof || prof.restaurant_id !== restaurantId) throw new Error("Usuário não encontrado");

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", targetId);
  if (!roles?.some((r: any) => r.role === role)) throw new Error(`Usuário não é ${label(role).toLowerCase()}`);
}

export const deleteChef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ChefIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const restaurantId = await ensureManager(supabase, userId);
    await assertTarget(supabase, restaurantId, data.chefId, data.role);

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
    await assertTarget(supabase, restaurantId, data.chefId, data.role);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.chefId, { password: data.password });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
