-- Custo unitário de várias fichas técnicas em uma única chamada.
-- O servidor (Cloudflare Worker) tem limite de chamadas por requisição;
-- chamar recipe_unit_cost uma vez por receita estourava esse limite.
-- Roda com as permissões de quem chama (RLS em recipes), então só
-- devolve receitas do próprio restaurante.
create or replace function public.recipes_unit_costs(_recipe_ids uuid[])
returns table (recipe_id uuid, unit_cost numeric)
language sql
stable
set search_path = public
as $$
  select r.id, coalesce(public.recipe_unit_cost(r.id), 0)
  from public.recipes r
  where r.id = any(_recipe_ids);
$$;

revoke execute on function public.recipes_unit_costs(uuid[]) from anon, public;
grant execute on function public.recipes_unit_costs(uuid[]) to authenticated;
