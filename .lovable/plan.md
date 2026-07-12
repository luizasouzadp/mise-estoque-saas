# Corrigir list_ingredients quando filtra por baixo estoque

## Diagnóstico

O restaurante tem **193 insumos**. A ferramenta MCP `list_ingredients` hoje:

1. Busca no Supabase com `limit(limit ?? 100)` — ou seja, traz só os **primeiros 100 por nome**.
2. Só **depois**, em memória, aplica `low_stock_only` filtrando `current_stock < min_stock`.

Resultado: dos 29 itens em baixo estoque, só aparecem os que caem alfabeticamente nos primeiros 100 registros — daí os 9 que o Claude está vendo. Não é limite do Claude, é a query da tool.

## Correção

Em `src/lib/mcp/tools/list-ingredients.ts`:

- Empurrar o filtro para o banco: quando `low_stock_only` for `true`, usar `.filter("current_stock", "lt", "min_stock")` (comparação coluna×coluna via PostgREST) em vez de filtrar no cliente.
- Quando `low_stock_only` for `true`, aumentar o teto padrão (ex.: `limit ?? 500`) para não recortar a lista completa de itens críticos.
- Manter `limit` explícito do usuário respeitado (máx. 500, como já está no schema).
- Atualizar a `description` da tool deixando claro que `low_stock_only` já é aplicado no banco e que `limit` é opcional.

Sem mudanças em UI, schema ou outras tools. `get_low_stock` continua existindo como alternativa dedicada (e sem limite), mas o Claude tende a chamar `list_ingredients` — por isso o fix vai lá.

## Verificação

Após o ajuste, rodar `bun run typecheck` (o harness já dispara) e conferir via chamada MCP que `list_ingredients({ low_stock_only: true })` retorna 29 itens.
