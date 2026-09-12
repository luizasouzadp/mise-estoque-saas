import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function randomEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

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

  const { data: perfil } = await anon
    .from("profiles")
    .select("restaurant_id")
    .eq("id", created.data.user.id)
    .single();

  return { client: anon, admin, userId: created.data.user.id, restaurantId: perfil!.restaurant_id as string };
}

describe("bloqueio de restaurante e aplicado no banco, nao so na tela", () => {
  it("restaurante bloqueado nao consegue mais ler seus proprios dados via REST", async () => {
    const { client, admin, restaurantId } = await createSignedInRestaurant("Restaurante Bloqueio Dados");

    // confirma que o acesso funciona normalmente enquanto ativo
    const antesDeBloquear = await client.from("restaurants").select("id").eq("id", restaurantId).maybeSingle();
    expect(antesDeBloquear.data?.id).toBe(restaurantId);

    const bloqueio = await admin.from("restaurants").update({ status: "bloqueado" }).eq("id", restaurantId);
    expect(bloqueio.error).toBeNull();

    const depoisDeBloquear = await client.from("restaurants").select("id").eq("id", restaurantId).maybeSingle();
    expect(depoisDeBloquear.data).toBeNull();

    const insercao = await client.from("ingredients").insert({ restaurant_id: restaurantId, name: "Teste Bloqueado" });
    expect(insercao.error).not.toBeNull();
  });

  it("dono de restaurante bloqueado nao consegue se autodesbloquear", async () => {
    const { client, admin, restaurantId } = await createSignedInRestaurant("Restaurante Autodesbloqueio");

    const bloqueio = await admin.from("restaurants").update({ status: "bloqueado" }).eq("id", restaurantId);
    expect(bloqueio.error).toBeNull();

    const tentativaDeAutodesbloqueio = await client
      .from("restaurants")
      .update({ status: "ativo" })
      .eq("id", restaurantId);

    // a politica de RLS nega a linha (current_restaurant_id() retorna null
    // para um restaurante bloqueado, entao a clausula "id = current_restaurant_id()"
    // nunca casa) - a chamada nao da erro, mas tambem nao afeta nenhuma linha
    expect(tentativaDeAutodesbloqueio.error).toBeNull();
    expect(tentativaDeAutodesbloqueio.count ?? 0).toBe(0);

    const { data: statusFinal } = await admin.from("restaurants").select("status").eq("id", restaurantId).single();
    expect(statusFinal?.status).toBe("bloqueado");
  });
});
