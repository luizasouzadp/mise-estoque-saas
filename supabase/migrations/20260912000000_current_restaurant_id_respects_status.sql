-- Fecha uma lacuna encontrada na revisao final: current_restaurant_id() nao
-- olhava o status do restaurante, entao a politica pre-existente "owners
-- update own restaurant" (que so verifica id = current_restaurant_id()) deixava
-- o proprio dono de um restaurante bloqueado reverter o status via REST, alem
-- de manter ingredients/purchases/profiles acessiveis mesmo bloqueado. Ao
-- tornar esta funcao ciente do status, toda politica existente que dependa
-- dela (restaurants, profiles, ingredients, purchases) passa a negar acesso
-- automaticamente para um restaurante bloqueado, sem precisar reescrever cada
-- politica individualmente.
create or replace function public.current_restaurant_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.restaurant_id
  from public.profiles p
  join public.restaurants r on r.id = p.restaurant_id
  where p.id = auth.uid() and r.status = 'ativo'
$$;
