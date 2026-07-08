# Expansão do servidor MCP — Assistente inteligente de estoque

Vou adicionar ~30 ferramentas novas ao servidor MCP existente (`src/lib/mcp/`), mantendo o padrão atual: um arquivo por ferramenta em `src/lib/mcp/tools/`, autenticação OAuth Supabase já configurada, e cada handler cria um client Supabase com o token do usuário (RLS aplica automaticamente por restaurante).

Todas as respostas serão JSON estruturado + um `content` textual curto em pt-BR para o modelo interpretar direto.

## Ferramentas por categoria

### Estoque (8)
- `get_inventory_summary` — nº itens, valor total, abaixo do mínimo, sem giro, zerados.
- `get_inventory_value` — valor financeiro (usa `avg_cost`/`last_cost` × `current_stock`), agrupado por categoria opcional.
- `get_product_stock` — saldo atual + mínimo + custo de 1 ingrediente (por id ou nome).
- `get_low_stock` — `current_stock < min_stock`.
- `get_out_of_stock` — `current_stock <= 0`.
- `get_products_near_minimum` — dentro de X% acima do mínimo (default 20%).
- `get_stock_movements` — histórico de `stock_movements` por ingrediente, com filtros de data/tipo.
- `get_inventory_snapshot` — estoque reconstruído em data específica (estoque atual − movimentações posteriores).

### Consumo (3)
- `get_product_consumption` — saídas agregadas em dia/semana/mês (usa `stock_movements` tipo `out` + `production_items`).
- `get_recipe_consumption` — quanto cada receita consumiu (via `productions` × `recipe_items`).
- `get_consumption_trends` — série temporal + variação % vs período anterior.

### Previsões / IA (7) — **prioridade**
Cálculos determinísticos server-side (média móvel + desvio-padrão sobre saídas diárias dos últimos 30–90 dias). Não chama LLM: retorna dados prontos para o LLM cliente interpretar.

- `predict_stock_depletion` — data prevista de ruptura, dias restantes, consumo médio/dia, intervalo (média ± 1,96·σ), risco (baixo/médio/alto) baseado em cobertura vs lead time.
- `predict_restock_date` — data recomendada de compra = data ruptura − lead time − estoque segurança em dias.
- `forecast_product_consumption` — projeção de consumo por dia/semana/mês para horizonte N.
- `suggest_purchase_quantity` — quanto comprar p/ cobrir 7/15/30 dias considerando consumo, sazonalidade (mesmo dia da semana), estoque atual, mínimo e segurança.
- `detect_abnormal_consumption` — dias com saída > média + 2σ, ou z-score alto.
- `detect_dead_stock` — sem movimentação há > N dias (default 60).
- `analyze_inventory_health` — score geral + lista priorizada de problemas e recomendações.

### Compras (4)
- `list_suppliers` — de `suppliers`.
- `get_supplier_products` — compras históricas por fornecedor (`purchases` join).
- `create_purchase_suggestion` — usa `suggest_purchase_quantity` para todos os ingredientes críticos e agrupa por fornecedor preferencial (último fornecedor de cada item).
- `create_purchase_order` — cria linhas em `purchases` (necessita `needsApproval: true`).

### Produção (2)
- `simulate_recipe_production` — calcula ingredientes que seriam consumidos + verifica se há estoque, sem gravar.
- `produce_recipe` — insere em `productions` + `production_items` (trigger já desconta estoque). `needsApproval: true`.

### Custos (3)
- `calculate_recipe_cost` — usa RPC existente `recipe_total_cost` / `recipe_unit_cost`.
- `calculate_food_cost` — custo receita / preço de venda (`menu_products`).
- `calculate_cmv` — usa dados de `cmv_reports` ou calcula on-the-fly por período.

### Inteligência (3)
- `get_dashboard` — agrega summary + críticos + previsões + CMV do período em uma única chamada.
- `generate_management_report` — relatório consolidado (estoque, consumo, CMV, alertas, recomendações) para período informado.
- (`analyze_inventory_health` já listado em Previsões)

## Detalhes técnicos

**Estrutura de cada ferramenta** (mesmo padrão dos 4 atuais):
```ts
export default defineTool({
  name, title, description,
  inputSchema: { ... zod ... },
  annotations: { readOnlyHint: true/false, destructiveHint, idempotentHint },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return { content:[{type:"text",text:"Não autenticado"}], isError:true };
    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` }},
      auth: { persistSession:false, autoRefreshToken:false },
    });
    // queries com RLS
    return { content:[{type:"text", text: resumoLegivel}], structuredContent: dadosJSON };
  }
});
```

**Helpers compartilhados** em `src/lib/mcp/lib/`:
- `supabase-for-user.ts` — factory do client autenticado (evita duplicar em cada tool).
- `stats.ts` — média, desvio-padrão, z-score, média móvel, sazonalidade por dia-da-semana.
- `forecast.ts` — funções de previsão consumidas por `predict_*` e `suggest_purchase_quantity`.
- `date-range.ts` — parsing de períodos (`last_7_days`, `last_30_days`, `YYYY-MM-DD..YYYY-MM-DD`).

**Fonte de saídas para previsões**: união de `stock_movements` (type=`out`, exceto motivo "Inventário") + `production_items` (via `productions.produced_at`). Isso captura tanto vendas/perdas quanto consumo por produção.

**Registro**: cada tool exportada é adicionada ao array `tools` em `src/lib/mcp/index.ts`.

**Manifest**: após todas as edições, rodar `app_mcp_server--extract_mcp_manifest` para regenerar `.lovable/mcp/manifest.json`.

**Sem novas migrations** — todas as tabelas necessárias já existem (`ingredients`, `stock_movements`, `productions`, `production_items`, `recipes`, `recipe_items`, `purchases`, `suppliers`, `menu_products`, `cmv_reports`).

**Aprovação (`needsApproval`)**: aplico em `record_stock_movement` (retroativo), `produce_recipe` e `create_purchase_order` — tudo que muta estoque ou cria pedidos.

## Perguntas antes de implementar

1. **Lead time e estoque de segurança**: hoje `ingredients` tem `min_stock` mas não vejo `lead_time_days` nem `safety_stock`. Posso:
   (a) usar defaults fixos (lead time = 3 dias, segurança = 20% do consumo semanal), ou
   (b) adicionar colunas `lead_time_days` e `safety_stock_days` em `ingredients` via migration.
2. **`create_purchase_order`**: crio direto em `purchases` (já vira entrada de estoque via trigger) ou prefere uma tabela nova de "pedidos pendentes" separada das compras efetivadas?
3. **Escopo desta entrega**: implemento **todas as ~30** de uma vez, ou prioriza as de **Previsões + Dashboard + Estoque** (o núcleo do assistente) e deixa Compras/Produção/Custos para uma segunda leva?