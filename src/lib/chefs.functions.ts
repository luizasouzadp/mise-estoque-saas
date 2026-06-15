import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CreateChefSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, "Apenas letras, números, _ . -"),
  password: z.string().min(6).max(100),
});

export const createChef = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateChefSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Caller must be owner or manager
    const { data: isMgr } = await supabase.rpc("is_manager_or_owner", { _user_id: userId });
    if (!isMgr) throw new Error("Sem permissão");

    // Get caller's restaurant
    const { data: prof } = await supabase.from("profiles").select("restaurant_id").eq("id", userId).maybeSingle();
    if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");

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

    // Override profile to point at caller's restaurant (handle_new_user created a new one)
    await supabaseAdmin.from("profiles").update({ restaurant_id: prof.restaurant_id, full_name: data.username }).eq("id", chefId);

    // Replace default 'owner' role with 'chef'
    await supabaseAdmin.from("user_roles").delete().eq("user_id", chefId);
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: chefId, role: "chef" });
    if (rErr) throw new Error(rErr.message);

    return { ok: true, username: data.username, email };
  });
