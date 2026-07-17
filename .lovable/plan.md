## Como a tela atual funciona hoje (por baixo dos panos)

Antes de estender, preciso te alinhar em duas coisas — porque a descrição que você fez ("casa itens por código com as fichas, calcula consumo estimado e compara com a contagem física da semana") não bate 100% com o que o código faz. A extensão diária muda dependendo dessa base.

### O que o fluxo de CMV faz hoje

1. **Cadastro do período** (`cmv_reports`) — o usuário informa `period_start`, `period_end` e `revenue`. **Não é semanal fixo**, é qualquer intervalo (na prática usado como mês/semana).

2. **Upload de vendas** — planilha com `product_code` + `quantity` (+ `unit_price` opcional). O `createSalesReport` do arquivo `src/lib/sales-reports.functions.ts`:
   - Faz o match do `product_code` contra `recipes.product_code` (com `is_on_menu = true`) **e** `menu_products.product_code`.
   - Grava linhas casadas em `sales_report_items` e não-casadas em `sales_report_unmapped`.
   - Consolida faturamento/custo/margem em `sales_reports`.
   - O custo unitário do item vendido vem de `recipe_unit_cost(recipe_id)` (RPC) ou de `menu_products.cost`.

3. **Análise dos insumos utilizados** (dentro da tela, no `IngredientDiffsTable`, arquivo `src/routes/_authenticated/cmv.index.tsx`, linhas ~568-708). Para cada insumo, calcula:
   - **Teórico**: expande recursivamente cada ficha vendida × qtd (respeitando `yield_qty`, sub-receitas e preparações estocadas em `ingredients.source_recipe_id`) → soma quanto de cada insumo *deveria* ter saído.
   - **Real**: soma `stock_movements` do tipo `out` no período `[period_start, period_end]`, filtrando saídas de produção de matéria-prima (para não contar duas vezes) e removendo preparos intermediários.
   - **Diferença** = real − teórico. Positivo = "Furo" (saiu mais do que a ficha previa). Negativo = "Sobra".

### Ponto importante — não é "contra a contagem física"

O comparativo hoje é **teórico (via ficha) × movimentações reais de saída**, não contra uma contagem física. A contagem entra *indiretamente* porque, quando você fecha um inventário, o sistema gera `stock_movements` de ajuste (`reason` começando com "Inventário") — e essas movimentações **entram** no "real" da tela. Ou seja, o furo/sobra que aparece já embute o ajuste de contagem, mas a tela não sabe distinguir "consumo de venda" de "ajuste de inventário".

### Tabelas envolvidas
- `cmv_reports` (cabeçalho + `sales_data` guardando `{productId: qtd}`)
- `sales_reports` + `sales_report_items` + `sales_report_unmapped` (upload de vendas propriamente dito)
- `recipes` / `recipe_items` / `menu_products` / `ingredients` (fichas e catálogo)
- `stock_movements` (fonte do "real")

---

## Como a extensão diária se encaixa

A boa notícia: **o motor de "vendas → consumo teórico por insumo"** (matching por código + expansão recursiva de fichas) já existe e é reutilizável. O que muda é a granularidade (diária) e o objetivo (projeção de saldo, não auditoria pós-fato).

### Plano proposto

**1. Extrair a expansão "vendas → insumos" para função reutilizável**
- Mover a lógica dos itens 2-3 acima (matching de código + `addRecipe` recursivo respeitando preparações estocadas e `composes_cmv`) para `src/lib/sales-consumption.ts`, usada tanto pela tela mensal atual quanto pelo novo upload diário. Sem mudar comportamento existente.

**2. Novo tipo de upload: "Vendas diárias"**
- Nova tabela `daily_sales_reports` (`restaurant_id`, `sales_date DATE`, `file_name`, `total_revenue`, `total_quantity`, `created_by`, `created_at`, `updated_at`) — 1 linha por dia; upload do mesmo dia faz upsert (substitui).
- Nova tabela `daily_sales_consumption` (`daily_report_id`, `ingredient_id`, `quantity_theoretical NUMERIC`) — consumo teórico por insumo naquele dia, gerado pelo motor do item 1.
- Nova rota: `/purchases/daily-sales` (ou dentro de `cmv.index.tsx` como aba) com upload de planilha idêntica ao formato atual + campo `sales_date`.

**3. Cálculo do saldo projetado por insumo**
- Para cada insumo, "último saldo real conhecido" = `ingredients.current_stock` no instante da última **âncora**. Âncora = última data em que houve um dos eventos: `stock_movements` com `reason` começando por "Inventário", ou o `current_stock` foi ajustado manualmente pela tela de ingrediente.
  - Vou adicionar coluna `ingredients.stock_anchor_at TIMESTAMPTZ` (atualizada pelos triggers/telas que hoje já mexem no estoque) para representar isso sem inferência frágil.
- **Saldo projetado hoje** = `current_stock` (na data da âncora) − Σ `quantity_theoretical` de `daily_sales_consumption` entre `stock_anchor_at` e hoje − Σ `stock_movements` de saída não-venda (produções que consomem esse insumo diretamente) + Σ compras/entradas no mesmo intervalo.
- Cálculo feito via view SQL `v_projected_stock` (insumo, projected_stock, days_since_anchor, has_daily_gap) para consumo simples pela UI e por alertas.

**4. Alerta de compra emergencial**
- Nova tela/card no dashboard e no `/ingredients` listando insumos onde `projected_stock < min_stock` (e sem compra em aberto que cubra o gap), separando os que já cruzaram o mínimo dos que projetam cruzar em N dias (parâmetro por insumo `days_of_cover_target` — default 3).
- Notificação visual (badge no menu lateral) e opção de gerar direto uma "sugestão de compra emergencial" reaproveitando `create_purchase_suggestion` do MCP.

**5. Manutenção da consistência com o fluxo mensal existente**
- Quando o usuário fizer o upload mensal/semanal atual, o sistema detecta sobreposição com dias já enviados no diário e:
  - opção A (default): consolida — ignora o diário nas datas já cobertas pelo relatório maior para não contar duas vezes.
  - opção B: mantém o diário e usa o mensal só para o comparativo teórico × real.
- Quando um inventário for finalizado, `stock_anchor_at` é atualizado e o projetado "zera" a dívida acumulada até ali automaticamente.

### Detalhes técnicos
- Backend: nova server function `createDailySalesReport` (mesma validação Zod do atual) + `getProjectedStock` (leitura da view).
- Frontend: tab "Diário" na tela CMV para upload; widget "Alerta emergencial" no dashboard; badge no ingrediente com projetado vs mínimo.
- Migração cria as duas novas tabelas + view + coluna `stock_anchor_at` + policies RLS por restaurante (mesmo padrão de `sales_reports`) + GRANTs.

### Confirmações que preciso de você
1. Concorda que "último saldo real" = última **contagem de inventário** finalizada para o insumo (âncora), e não o `current_stock` atual (que já é continuamente decrementado por movimentações)? Se preferir usar `current_stock` puro, o cálculo do projetado muda.
2. Uploads diários com sobreposição de dias devem substituir (upsert por `sales_date`) ou acumular?
3. O alerta é só "já abaixo do mínimo" ou também "vai ficar abaixo em X dias" (usando média de consumo dos últimos 7/14 dias)?
