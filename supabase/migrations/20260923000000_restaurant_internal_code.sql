-- Código interno curto por restaurante, usado para identificação em
-- suporte (o usuário informa o código, o admin busca por ele no painel).
create or replace function public.generate_restaurant_code()
returns text
language sql
as $$
  select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
$$;

alter table public.restaurants
  add column internal_code text unique;

update public.restaurants
  set internal_code = public.generate_restaurant_code()
  where internal_code is null;

alter table public.restaurants
  alter column internal_code set not null,
  alter column internal_code set default public.generate_restaurant_code();
