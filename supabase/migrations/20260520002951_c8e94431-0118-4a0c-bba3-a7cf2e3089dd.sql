
-- Enum de roles
create type public.app_role as enum ('owner', 'manager', 'staff');

-- Restaurants
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.restaurants enable row level security;

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create index on public.profiles(restaurant_id);

-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
alter table public.user_roles enable row level security;

-- Security definer helpers (no recursion)
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.current_restaurant_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select restaurant_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_manager_or_owner(_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role in ('owner','manager')
  )
$$;

-- Ingredients
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  unit text not null default 'un',
  category text,
  current_stock numeric not null default 0,
  avg_cost numeric not null default 0,
  last_cost numeric not null default 0,
  min_stock numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ingredients enable row level security;
create index on public.ingredients(restaurant_id);

-- Purchases
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  total_cost numeric not null,
  supplier text,
  purchased_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.purchases enable row level security;
create index on public.purchases(restaurant_id);
create index on public.purchases(ingredient_id);

-- updated_at trigger for ingredients
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger trg_ingredients_updated_at
  before update on public.ingredients
  for each row execute function public.set_updated_at();

-- Trigger: update stock + weighted avg cost on purchase insert
create or replace function public.apply_purchase_to_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cur_stock numeric;
  cur_avg numeric;
  new_stock numeric;
  new_avg numeric;
begin
  select current_stock, avg_cost into cur_stock, cur_avg
    from public.ingredients where id = new.ingredient_id;

  new_stock := coalesce(cur_stock,0) + new.quantity;
  if new_stock > 0 then
    new_avg := ((coalesce(cur_stock,0) * coalesce(cur_avg,0)) + (new.quantity * new.unit_cost)) / new_stock;
  else
    new_avg := new.unit_cost;
  end if;

  update public.ingredients
    set current_stock = new_stock,
        avg_cost = new_avg,
        last_cost = new.unit_cost
    where id = new.ingredient_id;
  return new;
end;
$$;
create trigger trg_apply_purchase
  after insert on public.purchases
  for each row execute function public.apply_purchase_to_stock();

-- Auto-create profile + restaurant + owner role on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_restaurant_id uuid;
  rest_name text;
  full_name text;
begin
  rest_name := coalesce(new.raw_user_meta_data->>'restaurant_name', 'Meu Restaurante');
  full_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1));

  insert into public.restaurants(name) values (rest_name) returning id into new_restaurant_id;
  insert into public.profiles(id, restaurant_id, full_name) values (new.id, new_restaurant_id, full_name);
  insert into public.user_roles(user_id, role) values (new.id, 'owner');
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS Policies
-- restaurants: members can view their restaurant, owners can update
create policy "members view own restaurant" on public.restaurants
  for select to authenticated using (id = public.current_restaurant_id());
create policy "owners update own restaurant" on public.restaurants
  for update to authenticated using (id = public.current_restaurant_id() and public.has_role(auth.uid(),'owner'));

-- profiles
create policy "view own profile or same restaurant" on public.profiles
  for select to authenticated using (restaurant_id = public.current_restaurant_id());
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid());

-- user_roles
create policy "view own roles" on public.user_roles
  for select to authenticated using (user_id = auth.uid());

-- ingredients
create policy "members view ingredients" on public.ingredients
  for select to authenticated using (restaurant_id = public.current_restaurant_id());
create policy "managers insert ingredients" on public.ingredients
  for insert to authenticated with check (
    restaurant_id = public.current_restaurant_id() and public.is_manager_or_owner(auth.uid())
  );
create policy "managers update ingredients" on public.ingredients
  for update to authenticated using (
    restaurant_id = public.current_restaurant_id() and public.is_manager_or_owner(auth.uid())
  );
create policy "managers delete ingredients" on public.ingredients
  for delete to authenticated using (
    restaurant_id = public.current_restaurant_id() and public.is_manager_or_owner(auth.uid())
  );

-- purchases
create policy "members view purchases" on public.purchases
  for select to authenticated using (restaurant_id = public.current_restaurant_id());
create policy "managers insert purchases" on public.purchases
  for insert to authenticated with check (
    restaurant_id = public.current_restaurant_id() and public.is_manager_or_owner(auth.uid())
  );
create policy "managers delete purchases" on public.purchases
  for delete to authenticated using (
    restaurant_id = public.current_restaurant_id() and public.is_manager_or_owner(auth.uid())
  );
