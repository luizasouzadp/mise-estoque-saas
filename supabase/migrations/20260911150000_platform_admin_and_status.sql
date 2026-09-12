-- Status de acesso por restaurante (controle manual de pagamento pela plataforma)
alter table public.restaurants
  add column status text not null default 'ativo' check (status in ('ativo', 'bloqueado'));

-- Sinalizador de administrador da plataforma (distinto do papel "owner" de um restaurante)
alter table public.profiles
  add column is_platform_admin boolean not null default false;

-- Funcao auxiliar: indica se o usuario autenticado e admin da plataforma
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

-- Prevencao de autopromocao: reverte qualquer tentativa de um usuario comum
-- (ou de uma sessao raw sem auth.uid(), exceto bootstrap manual) de se marcar
-- ou marcar outro perfil como is_platform_admin sem ja ser admin da plataforma.
create or replace function public.enforce_is_platform_admin_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_platform_admin and auth.uid() is not null and not public.is_platform_admin() then
      new.is_platform_admin := false;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.is_platform_admin is distinct from old.is_platform_admin
       and auth.uid() is not null
       and not public.is_platform_admin() then
      new.is_platform_admin := old.is_platform_admin;
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_enforce_is_platform_admin_immutable
before insert or update on public.profiles
for each row execute function public.enforce_is_platform_admin_immutable();

-- Politicas adicionais: admin da plataforma enxerga e administra todos os
-- restaurantes/perfis, alem das politicas ja existentes por restaurante.
create policy "platform admin visualiza todos os restaurantes"
  on public.restaurants for select
  to authenticated using (public.is_platform_admin());

create policy "platform admin atualiza qualquer restaurante"
  on public.restaurants for update
  to authenticated using (public.is_platform_admin());

create policy "platform admin visualiza todos os perfis"
  on public.profiles for select
  to authenticated using (public.is_platform_admin());
