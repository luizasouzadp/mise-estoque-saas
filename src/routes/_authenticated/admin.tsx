import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Pencil, LogIn } from "lucide-react";
import { listRestaurants, setRestaurantStatus, createRestaurantClient, renameRestaurant, impersonateRestaurant } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const { data: prof } = await supabase
      .from("profiles")
      .select("is_platform_admin")
      .eq("id", data.session.user.id)
      .maybeSingle();
    if (!prof?.is_platform_admin) throw redirect({ to: "/dashboard" });
  },
  component: AdminPage,
});

type Restaurant = { id: string; name: string; status: string; internal_code: string; ownerEmails: string[] };

function AdminPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [restaurantName, setRestaurantName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Restaurant | null>(null);
  const [editName, setEditName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [search, setSearch] = useState("");
  const [accessingId, setAccessingId] = useState<string | null>(null);

  const listFn = useServerFn(listRestaurants);
  const statusFn = useServerFn(setRestaurantStatus);
  const createFn = useServerFn(createRestaurantClient);
  const renameFn = useServerFn(renameRestaurant);
  const impersonateFn = useServerFn(impersonateRestaurant);

  const filteredRestaurants = restaurants.filter((r) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      r.name.toLowerCase().includes(term) ||
      r.internal_code.toLowerCase().includes(term) ||
      r.ownerEmails.some((e) => e.toLowerCase().includes(term))
    );
  });

  async function refresh() {
    setLoading(true);
    try {
      setRestaurants(await listFn());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao listar restaurantes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleStatus(r: Restaurant) {
    const novoStatus = r.status === "ativo" ? "bloqueado" : "ativo";
    try {
      await statusFn({ data: { restaurantId: r.id, status: novoStatus } });
      toast.success(`${r.name} agora está ${novoStatus}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar status");
    }
  }

  function openEdit(r: Restaurant) {
    setEditing(r);
    setEditName(r.name);
  }

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const name = editName.trim();
    if (!name) return toast.error("Informe o nome do restaurante.");
    setRenaming(true);
    try {
      await renameFn({ data: { restaurantId: editing.id, name } });
      toast.success("Nome atualizado.");
      setEditing(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar nome");
    } finally {
      setRenaming(false);
    }
  }

  async function accessAsRestaurant(r: Restaurant) {
    if (!confirm(`Acessar a conta de "${r.name}"? Sua sessão de administradora nesta aba será substituída pela sessão do restaurante.`)) return;
    setAccessingId(r.id);
    try {
      const { actionLink } = await impersonateFn({ data: { restaurantId: r.id, origin: window.location.origin } });
      window.location.href = actionLink;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao acessar restaurante");
    } finally {
      setAccessingId(null);
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await createFn({ data: { restaurantName, ownerName, email, password } });
      toast.success("Restaurante criado");
      setRestaurantName("");
      setOwnerName("");
      setEmail("");
      setPassword("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar restaurante");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="font-display text-2xl">Administração da plataforma</h1>

      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Restaurantes cadastrados</h2>
        <Input
          className="mt-3"
          placeholder="Buscar por nome, código ou e-mail"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {loading ? (
          <p className="mt-3 text-sm text-muted-foreground">Carregando...</p>
        ) : filteredRestaurants.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum restaurante encontrado.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {filteredRestaurants.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.status} · código {r.internal_code}</div>
                  {r.ownerEmails.length > 0 && (
                    <div className="text-xs text-muted-foreground">{r.ownerEmails.join(", ")}</div>
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => accessAsRestaurant(r)} disabled={accessingId === r.id}>
                    <LogIn className="mr-1 h-4 w-4" /> Acessar como este restaurante
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                    <Pencil className="mr-1 h-4 w-4" /> Editar nome
                  </Button>
                  <Button
                    size="sm"
                    variant={r.status === "ativo" ? "destructive" : "default"}
                    onClick={() => toggleStatus(r)}
                  >
                    {r.status === "ativo" ? "Bloquear" : "Ativar"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar nome do restaurante</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveRename} className="space-y-3">
            <div>
              <Label htmlFor="editName">Nome do restaurante</Label>
              <Input id="editName" required value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={renaming}>{renaming ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <form onSubmit={submitCreate} className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Cadastrar novo restaurante-cliente</h2>
        <div>
          <Label htmlFor="restaurantName">Nome do restaurante</Label>
          <Input id="restaurantName" required value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ownerName">Nome do responsável</Label>
          <Input id="ownerName" required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="email">E-mail de acesso</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Senha inicial</Label>
          <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" disabled={creating}>
          {creating ? "Criando..." : "Criar restaurante"}
        </Button>
      </form>
    </div>
  );
}
