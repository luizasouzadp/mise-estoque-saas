-- 1) ingredient_groups
create table public.ingredient_groups (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.ingredient_groups enable row level security;
create policy "members view groups" on public.ingredient_groups for select to authenticated
  using (restaurant_id = current_restaurant_id());
create policy "managers insert groups" on public.ingredient_groups for insert to authenticated
  with check (restaurant_id = current_restaurant_id() and is_manager_or_owner(auth.uid()));
create policy "managers update groups" on public.ingredient_groups for update to authenticated
  using (restaurant_id = current_restaurant_id() and is_manager_or_owner(auth.uid()));
create policy "managers delete groups" on public.ingredient_groups for delete to authenticated
  using (restaurant_id = current_restaurant_id() and is_manager_or_owner(auth.uid()));

-- 2) ingredient group_id
alter table public.ingredients add column group_id uuid references public.ingredient_groups(id) on delete set null;
create index ingredients_group_id_idx on public.ingredients(group_id);

-- 3) inventories
create table public.inventories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  group_id uuid references public.ingredient_groups(id) on delete set null,
  public_token uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  scheduled_for date,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid
);
alter table public.inventories enable row level security;
create policy "members view inventories" on public.inventories for select to authenticated
  using (restaurant_id = current_restaurant_id());
create policy "managers insert inventories" on public.inventories for insert to authenticated
  with check (restaurant_id = current_restaurant_id() and is_manager_or_owner(auth.uid()));
create policy "managers update inventories" on public.inventories for update to authenticated
  using (restaurant_id = current_restaurant_id() and is_manager_or_owner(auth.uid()));
create policy "managers delete inventories" on public.inventories for delete to authenticated
  using (restaurant_id = current_restaurant_id() and is_manager_or_owner(auth.uid()));

-- 4) inventory_items
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventories(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  ingredient_name text not null,
  unit text not null,
  expected_qty numeric not null default 0,
  counted_qty numeric,
  created_at timestamptz not null default now()
);
create index inventory_items_inventory_idx on public.inventory_items(inventory_id);
alter table public.inventory_items enable row level security;
create policy "members view inventory items" on public.inventory_items for select to authenticated
  using (exists (select 1 from public.inventories inv where inv.id = inventory_id and inv.restaurant_id = current_restaurant_id()));
create policy "managers manage inventory items" on public.inventory_items for all to authenticated
  using (exists (select 1 from public.inventories inv where inv.id = inventory_id and inv.restaurant_id = current_restaurant_id() and is_manager_or_owner(auth.uid())))
  with check (exists (select 1 from public.inventories inv where inv.id = inventory_id and inv.restaurant_id = current_restaurant_id() and is_manager_or_owner(auth.uid())));

-- 5) inventory_schedules
create table public.inventory_schedules (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  group_id uuid references public.ingredient_groups(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  time_of_day time not null default '09:00',
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.inventory_schedules enable row level security;
create policy "members view schedules" on public.inventory_schedules for select to authenticated
  using (restaurant_id = current_restaurant_id());
create policy "managers manage schedules" on public.inventory_schedules for all to authenticated
  using (restaurant_id = current_restaurant_id() and is_manager_or_owner(auth.uid()))
  with check (restaurant_id = current_restaurant_id() and is_manager_or_owner(auth.uid()));