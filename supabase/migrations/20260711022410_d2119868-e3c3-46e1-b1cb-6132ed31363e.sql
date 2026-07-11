
-- pg_trgm for fuzzy ingredient matching
create extension if not exists pg_trgm;
create index if not exists ingredients_name_trgm_idx on public.ingredients using gin (name gin_trgm_ops);

-- Suppliers get optional tax_id (CNPJ)
alter table public.suppliers add column if not exists tax_id text;
create unique index if not exists suppliers_restaurant_tax_id_uniq
  on public.suppliers (restaurant_id, tax_id) where tax_id is not null;

-- Purchases: track invoice image + source
alter table public.purchases add column if not exists invoice_image_path text;
alter table public.purchases add column if not exists source text not null default 'manual';

-- Package aliases per ingredient (learned unit conversions)
create table if not exists public.ingredient_unit_aliases (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  from_unit text not null,
  factor numeric not null check (factor > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ingredient_id, from_unit)
);

grant select, insert, update, delete on public.ingredient_unit_aliases to authenticated;
grant all on public.ingredient_unit_aliases to service_role;

alter table public.ingredient_unit_aliases enable row level security;

create policy "aliases select by restaurant"
  on public.ingredient_unit_aliases for select to authenticated
  using (restaurant_id = public.current_restaurant_id());
create policy "aliases insert by restaurant"
  on public.ingredient_unit_aliases for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());
create policy "aliases update by restaurant"
  on public.ingredient_unit_aliases for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());
create policy "aliases delete by restaurant"
  on public.ingredient_unit_aliases for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

create trigger trg_ingredient_unit_aliases_updated_at
  before update on public.ingredient_unit_aliases
  for each row execute function public.set_updated_at();

-- Learned matches: raw invoice text -> ingredient
create table if not exists public.purchase_import_matches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  raw_text_normalized text not null,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  hits integer not null default 1,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (restaurant_id, raw_text_normalized)
);

grant select, insert, update, delete on public.purchase_import_matches to authenticated;
grant all on public.purchase_import_matches to service_role;

alter table public.purchase_import_matches enable row level security;

create policy "import matches select by restaurant"
  on public.purchase_import_matches for select to authenticated
  using (restaurant_id = public.current_restaurant_id());
create policy "import matches insert by restaurant"
  on public.purchase_import_matches for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());
create policy "import matches update by restaurant"
  on public.purchase_import_matches for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());
create policy "import matches delete by restaurant"
  on public.purchase_import_matches for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());
