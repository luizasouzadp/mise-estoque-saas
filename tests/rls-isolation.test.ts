import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function randomEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function signUpRestaurant(restaurantName: string) {
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

  const { data: perfil } = await anon
    .from("profiles")
    .select("restaurant_id")
    .eq("id", created.data.user.id)
    .single();
  return { client: anon, userId: created.data.user.id, restaurantId: perfil!.restaurant_id as string };
}

describe("isolamento entre restaurantes (RLS)", () => {
  it("um restaurante nao consegue ler ingredientes de outro restaurante", async () => {
    const a = await signUpRestaurant("Restaurante Isolamento A");
    const b = await signUpRestaurant("Restaurante Isolamento B");

    const insertA = await a.client
      .from("ingredients")
      .insert({ restaurant_id: a.restaurantId, name: "Farinha A" });
    expect(insertA.error).toBeNull();

    const insertB = await b.client
      .from("ingredients")
      .insert({ restaurant_id: b.restaurantId, name: "Farinha B" });
    expect(insertB.error).toBeNull();

    const vistoPorA = await a.client.from("ingredients").select("name");
    const nomesVistosPorA = (vistoPorA.data ?? []).map((i) => i.name);

    expect(nomesVistosPorA).toContain("Farinha A");
    expect(nomesVistosPorA).not.toContain("Farinha B");
  });

  it("um restaurante nao consegue ler o perfil de outro restaurante", async () => {
    const a = await signUpRestaurant("Restaurante Isolamento Perfil A");
    const b = await signUpRestaurant("Restaurante Isolamento Perfil B");

    const vistoPorA = await a.client.from("profiles").select("id");
    const idsVistosPorA = (vistoPorA.data ?? []).map((p) => p.id);

    expect(idsVistosPorA).not.toContain(b.userId);
  });
});
