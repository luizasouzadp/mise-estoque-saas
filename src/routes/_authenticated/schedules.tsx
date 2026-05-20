import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Trash2, Plus, CalendarClock, MessageCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/schedules")({ component: SchedulesPage });

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function SchedulesPage() {
  const qc = useQueryClient();
  const [groupId, setGroupId] = useState<string>("all");
  const [weekday, setWeekday] = useState("1");
  const [time, setTime] = useState("09:00");
  const [phone, setPhone] = useState("");

  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await supabase.from("ingredient_groups").select("id, name").order("name")).data ?? [],
  });

  const { data: schedules } = useQuery({
    queryKey: ["schedules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_schedules")
        .select("id, group_id, weekday, time_of_day, phone, active")
        .order("weekday");
      if (error) throw error;
      return data;
    },
  });

  async function createSchedule(e: React.FormEvent) {
    e.preventDefault();
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!profile?.restaurant_id) return toast.error("Restaurante não encontrado");
    const { error } = await supabase.from("inventory_schedules").insert({
      restaurant_id: profile.restaurant_id,
      group_id: groupId === "all" ? null : groupId,
      weekday: Number(weekday),
      time_of_day: time,
      phone: phone.replace(/\D/g, "") || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Agendamento criado");
    setPhone("");
    qc.invalidateQueries({ queryKey: ["schedules"] });
  }

  async function toggle(id: string, active: boolean) {
    await supabase.from("inventory_schedules").update({ active }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["schedules"] });
  }

  async function remove(id: string) {
    await supabase.from("inventory_schedules").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["schedules"] });
  }

  async function runNow(s: { id: string; group_id: string | null; phone: string | null }) {
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    const { data: userData } = await supabase.auth.getUser();
    if (!profile?.restaurant_id) return toast.error("Restaurante não encontrado");

    let ingQuery = supabase.from("ingredients").select("id, name, unit, current_stock").eq("restaurant_id", profile.restaurant_id);
    if (s.group_id) ingQuery = ingQuery.eq("group_id", s.group_id);
    const { data: ings } = await ingQuery;
    if (!ings || ings.length === 0) return toast.error("Nenhum insumo neste grupo");

    const { data: inv, error } = await supabase.from("inventories").insert({
      restaurant_id: profile.restaurant_id,
      group_id: s.group_id,
      created_by: userData.user?.id ?? null,
    }).select("id, public_token").single();
    if (error) return toast.error(error.message);

    await supabase.from("inventory_items").insert(
      ings.map((i) => ({
        inventory_id: inv.id, ingredient_id: i.id, ingredient_name: i.name,
        unit: i.unit, expected_qty: Number(i.current_stock) || 0,
      })),
    );

    const link = `${window.location.origin}/count/${inv.public_token}`;
    const msg = `Olá! Hora do inventário. Conte os insumos por aqui: ${link}`;
    if (s.phone) {
      window.open(`https://wa.me/${s.phone}?text=${encodeURIComponent(msg)}`, "_blank");
    } else {
      await navigator.clipboard.writeText(link);
      toast.success("Link copiado");
    }
    qc.invalidateQueries({ queryKey: ["inventories"] });
  }

  const groupName = (id: string | null) => id ? (groups ?? []).find((g) => g.id === id)?.name ?? "—" : "Todos os insumos";

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <div className="flex items-center gap-3">
        <CalendarClock className="h-6 w-6 text-primary" />
        <div>
          <h1 className="font-display text-3xl">Agendamentos</h1>
          <p className="text-sm text-muted-foreground">Programe o inventário semanal e envie o link por WhatsApp.</p>
        </div>
      </div>

      <form onSubmit={createSchedule} className="mt-6 space-y-3 rounded-xl border bg-card p-5 shadow-[var(--shadow-soft)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Grupo</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os insumos</SelectItem>
                {(groups ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Dia da semana</Label>
            <Select value={weekday} onValueChange={setWeekday}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Horário</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <Label>WhatsApp (com DDI)</Label>
            <Input placeholder="5511999998888" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit"><Plus className="mr-2 h-4 w-4" /> Adicionar</Button>
        </div>
      </form>

      <div className="mt-6 space-y-3">
        {(schedules ?? []).length === 0 ? (
          <p className="rounded-xl border-2 border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
            Nenhum agendamento ainda.
          </p>
        ) : (schedules ?? []).map((s) => (
          <div key={s.id} className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{WEEKDAYS[s.weekday]} às {s.time_of_day?.slice(0, 5)}</div>
                <div className="text-xs text-muted-foreground">
                  {groupName(s.group_id)} {s.phone && <>· 📱 +{s.phone}</>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={s.active} onCheckedChange={(v) => toggle(s.id, v)} />
                <Button size="sm" variant="outline" onClick={() => runNow(s)}>
                  <MessageCircle className="mr-2 h-4 w-4" /> Gerar agora
                </Button>
                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => remove(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        💡 Para o envio automático no dia/hora programado é necessário habilitar uma integração. Por enquanto, use o botão <b>Gerar agora</b> para criar o inventário e abrir o WhatsApp com o link pronto.
      </p>
    </div>
  );
}
