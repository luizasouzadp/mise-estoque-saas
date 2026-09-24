import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Trash2, Users, Pencil } from "lucide-react";
import { useUserRoles } from "@/hooks/use-roles";
import { createChef, listChefs, deleteChef, resetChefPassword } from "@/lib/chefs.functions";
import { getMyRestaurantId } from "@/lib/profile";

type Person = { id: string; username: string; email: string };
type Role = "chef" | "receiver";

const COPY: Record<Role, { title: string; single: string; hint: string; placeholder: string }> = {
  chef: {
    title: "Usuários de cozinha",
    single: "usuário de cozinha",
    hint: "Acessa apenas a página de Produção.",
    placeholder: "ex: cozinha.joao",
  },
  receiver: {
    title: "Usuários de recebimento",
    single: "usuário de recebimento",
    hint: "Acessa apenas a página de Encomendas: confirma recebimentos e anexa fotos das notas, sem dar entrada no estoque.",
    placeholder: "ex: recebimento.ana",
  },
};

function PeopleManager({ role }: { role: Role }) {
  const copy = COPY[role];
  const [people, setPeople] = useState<Person[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState("");

  const create = useServerFn(createChef);
  const listFn = useServerFn(listChefs);
  const delFn = useServerFn(deleteChef);
  const resetFn = useServerFn(resetChefPassword);

  async function refresh() {
    setLoadingList(true);
    try {
      setPeople(await listFn({ data: { role } }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao listar usuários");
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) return toast.error("Usuário inválido (3-40 caracteres, letras/números/_.-)");
    if (password.length < 6) return toast.error("Senha deve ter ao menos 6 caracteres");
    setBusy(true);
    try {
      await create({ data: { username, password, role } });
      toast.success(`"${username}" criado.`);
      setUsername(""); setPassword("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar usuário");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Apagar o ${copy.single} "${name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await delFn({ data: { chefId: id, role } });
      toast.success("Usuário apagado");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao apagar");
    }
  }

  async function handleReset(id: string) {
    if (newPwd.length < 6) return toast.error("Senha deve ter ao menos 6 caracteres");
    try {
      await resetFn({ data: { chefId: id, password: newPwd, role } });
      toast.success("Senha redefinida");
      setResetFor(null); setNewPwd("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao redefinir senha");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{copy.hint}</p>

      {loadingList ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum {copy.single} cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {people.map((c) => (
            <div key={c.id} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{c.username}</div>
                  <div className="text-xs text-muted-foreground truncate">Login: {c.username}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button type="button" size="sm" variant="outline" onClick={() => { setResetFor(resetFor === c.id ? null : c.id); setNewPwd(""); }}>
                    Redefinir senha
                  </Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => handleDelete(c.id, c.username)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {resetFor === c.id && (
                <div className="flex gap-2">
                  <Input type="text" placeholder="Nova senha (mín. 6)" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
                  <Button type="button" size="sm" onClick={() => handleReset(c.id)}>Salvar</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="space-y-3 border-t pt-4">
        <div className="text-sm font-medium">Cadastrar novo {copy.single}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Nome de usuário</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={copy.placeholder} autoComplete="off" />
          </div>
          <div>
            <Label>Senha</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        <Button type="submit" disabled={busy}>{busy ? "Criando..." : "Criar acesso"}</Button>
        <p className="text-xs text-muted-foreground">
          Por segurança, a senha não pode ser exibida. Use "Redefinir senha" para definir uma nova.
        </p>
      </form>
    </div>
  );
}

function ContactsManager() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");

  const { data: contacts } = useQuery({
    queryKey: ["whatsapp_contacts"],
    queryFn: async () => {
      const { data } = await supabase.from("whatsapp_contacts").select("id, name, phone").order("name");
      return data ?? [];
    },
  });

  async function addContact() {
    const cleaned = phone.replace(/\D/g, "");
    if (!name.trim() || cleaned.length < 10) return toast.error("Informe nome e telefone válido");
    const restaurantId = await getMyRestaurantId();
    if (!restaurantId) return toast.error("Restaurante não encontrado");
    const { error } = await supabase.from("whatsapp_contacts").insert({
      restaurant_id: restaurantId, name: name.trim(), phone: cleaned,
    });
    if (error) return toast.error(error.message);
    setName(""); setPhone("");
    qc.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
    toast.success("Contato salvo");
  }

  async function deleteContact(id: string) {
    const { error } = await supabase.from("whatsapp_contacts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
  }

  function startEdit(c: { id: string; name: string; phone: string }) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditPhone(c.phone);
  }

  async function saveEdit(id: string) {
    const cleaned = editPhone.replace(/\D/g, "");
    if (!editName.trim() || cleaned.length < 10) return toast.error("Informe nome e telefone válido");
    const { error } = await supabase.from("whatsapp_contacts").update({
      name: editName.trim(), phone: cleaned,
    }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditingId(null);
    qc.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
    toast.success("Contato atualizado");
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Contatos usados para enviar contagens de inventário e ordens de compra pelo WhatsApp.
      </p>
      {(contacts ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum contato salvo.</p>
      ) : (
        <div className="space-y-2">
          {(contacts ?? []).map((c) => (
            <div key={c.id} className="rounded-md border p-3 space-y-2">
              {editingId === c.id ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                  <div>
                    <Label className="text-xs">Nome</Label>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Telefone (DDD + número)</Label>
                    <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} inputMode="numeric" />
                  </div>
                  <Button size="sm" onClick={() => saveEdit(c.id)}>Salvar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.phone}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => startEdit(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteContact(c.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <Label>Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Maria" />
        </div>
        <div>
          <Label>Telefone (DDD + número)</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11999998888" inputMode="numeric" />
        </div>
        <Button onClick={addContact}>Salvar contato</Button>
      </div>
    </div>
  );
}

function RestaurantCodeCard() {
  const { data: code } = useQuery({
    queryKey: ["restaurant-internal-code"],
    queryFn: async () => {
      const restaurantId = await getMyRestaurantId();
      if (!restaurantId) return null;
      const { data } = await supabase.from("restaurants").select("internal_code").eq("id", restaurantId).maybeSingle();
      return data?.internal_code ?? null;
    },
  });
  if (!code) return null;
  return (
    <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-soft)]">
      <p className="text-sm text-muted-foreground">Código do restaurante (informe este código se precisar de suporte)</p>
      <p className="mt-1 font-mono text-lg font-semibold">{code}</p>
    </div>
  );
}

export function UserSettings() {
  const { isChef, isReceiver, loading } = useUserRoles();
  if (loading || isChef || isReceiver) return null;

  return (
    <div className="space-y-4">
    <RestaurantCodeCard />
    <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-soft)]">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Users className="h-5 w-5 text-primary" /> Configurações de usuários
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Cadastre acessos da equipe e os contatos de WhatsApp do restaurante.
      </p>
      <Tabs defaultValue="chef" className="mt-4">
        <TabsList>
          <TabsTrigger value="chef">Cozinha</TabsTrigger>
          <TabsTrigger value="receiver">Recebimento</TabsTrigger>
          <TabsTrigger value="contacts">Contatos WhatsApp</TabsTrigger>
        </TabsList>
        <TabsContent value="chef" className="mt-4"><PeopleManager role="chef" /></TabsContent>
        <TabsContent value="receiver" className="mt-4"><PeopleManager role="receiver" /></TabsContent>
        <TabsContent value="contacts" className="mt-4"><ContactsManager /></TabsContent>
      </Tabs>
    </div>
    </div>
  );
}
