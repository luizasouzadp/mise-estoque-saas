import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function randomEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/**
 * Creates a confirmed test user via the admin API (no confirmation e-mail
 * sent, so tests never hit Supabase's e-mail rate limit), then signs in
 * with a fresh anon client to get an RLS-scoped session for assertions.
 */
async function createSignedInRestaurant(restaurantName: string) {
  const admin = createClient(url, serviceRoleKey);
  const anon = createClient(url, anonKey);
  const email = randomEmail(restaurantName.replace(/\s+/g, "-").toLowerCase());
  const senha = "SenhaForte123!";

  const created = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { restaurant_name: restaurantName },
  });
  if (created.error || !created.data.user) throw created.error;

  const signIn = await anon.auth.signInWithPassword({ email, password: senha });
  if (signIn.error) throw signIn.error;

  return { client: anon, userId: created.data.user.id };
}

describe("protecao contra autopromocao a admin da plataforma", () => {
  it("usuario comum nao consegue se marcar como is_platform_admin", async () => {
    const { client, userId } = await createSignedInRestaurant("Restaurante Teste Admin");

    const tentativa = await client
      .from("profiles")
      .update({ is_platform_admin: true })
      .eq("id", userId);
    expect(tentativa.error).toBeNull(); // a trigger silenciosamente reverte, nao rejeita

    const { data: perfil } = await client
      .from("profiles")
      .select("is_platform_admin")
      .eq("id", userId)
      .single();
    expect(perfil?.is_platform_admin).toBe(false);
  });

  it("novo restaurante nasce com status ativo", async () => {
    const { client, userId } = await createSignedInRestaurant("Restaurante Novo Teste");

    const { data: perfil } = await client
      .from("profiles")
      .select("restaurant_id")
      .eq("id", userId)
      .single();

    const { data: restaurante } = await client
      .from("restaurants")
      .select("status")
      .eq("id", perfil!.restaurant_id)
      .single();
    expect(restaurante?.status).toBe("ativo");
  });
});
