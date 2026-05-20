-- 1. Many-to-many ingredient ↔ groups
create table public.ingredient_group_members (
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  group_id uuid not null references public.ingredient_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (ingredient_id, group_id)
);

alter table public.ingredient_group_members enable row level security;

create policy "members view ingredient_group_members"
  on public.ingredient_group_members for select to authenticated
  using (exists (
    select 1 from public.ingredients i
    where i.id = ingredient_id and i.restaurant_id = current_restaurant_id()
  ));

create policy "managers insert ingredient_group_members"
  on public.ingredient_group_members for insert to authenticated
  with check (exists (
    select 1 from public.ingredients i
    where i.id = ingredient_id
      and i.restaurant_id = current_restaurant_id()
      and is_manager_or_owner(auth.uid())
  ));

create policy "managers delete ingredient_group_members"
  on public.ingredient_group_members for delete to authenticated
  using (exists (
    select 1 from public.ingredients i
    where i.id = ingredient_id
      and i.restaurant_id = current_restaurant_id()
      and is_manager_or_owner(auth.uid())
  ));

-- Backfill from existing ingredients.group_id
insert into public.ingredient_group_members (ingredient_id, group_id)
  select id, group_id from public.ingredients
  where group_id is not null
  on conflict do nothing;

create index ingredient_group_members_group_idx on public.ingredient_group_members(group_id);

-- 2. Inventory sessions (one per group within an inventory day)
create table public.inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  group_id uuid references public.ingredient_groups(id) on delete set null,
  public_token uuid not null unique default gen_random_uuid(),
  status text not null default 'pending',
  assigned_to text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.inventory_sessions enable row level security;

create policy "members view inventory_sessions"
  on public.inventory_sessions for select to authenticated
  using (exists (
    select 1 from public.inventories inv
    where inv.id = inventory_id and inv.restaurant_id = current_restaurant_id()
  ));

create policy "managers manage inventory_sessions"
  on public.inventory_sessions for all to authenticated
  using (exists (
    select 1 from public.inventories inv
    where inv.id = inventory_id
      and inv.restaurant_id = current_restaurant_id()
      and is_manager_or_owner(auth.uid())
  ))
  with check (exists (
    select 1 from public.inventories inv
    where inv.id = inventory_id
      and inv.restaurant_id = current_restaurant_id()
      and is_manager_or_owner(auth.uid())
  ));

create index inventory_sessions_inventory_idx on public.inventory_sessions(inventory_id);

-- 3. Add session_id to inventory_items + migrate
alter table public.inventory_items
  add column session_id uuid references public.inventory_sessions(id) on delete cascade;

-- Create one session per existing inventory, reusing its public_token/status
insert into public.inventory_sessions (id, inventory_id, group_id, public_token, status, completed_at, created_at)
  select gen_random_uuid(), id, group_id, public_token, status, completed_at, created_at
  from public.inventories;

update public.inventory_items ii
  set session_id = s.id
  from public.inventory_sessions s
  where s.inventory_id = ii.inventory_id
    and ii.session_id is null;

alter table public.inventory_items alter column session_id set not null;
create index inventory_items_session_idx on public.inventory_items(session_id);