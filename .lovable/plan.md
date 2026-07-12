# Fornecedor padrão + agenda de entrega

Adicionar fornecedor padrão por insumo e agenda semanal por fornecedor, para que a lista de compras seja agrupada pelo fornecedor real e o horizonte de cobertura respeite os dias de pedido/entrega de cada um.

## 1. Migração de banco

Uma migração única com:

**`suppliers`** — novas colunas:
- `delivery_days` `smallint[]` (0=domingo…6=sábado), default `'{}'`, com `CHECK` garantindo valores 0–6.
- `order_days` `smallint[]`, mesmo padrão.
- `lead_time_days` `integer` nullable, `CHECK (lead_time_days >= 0)`.
- `min_order_value` `numeric(12,2)` nullable, `CHECK (min_order_value >= 0)`.
- `notes` `text` nullable.

**`ingredients`** — nova coluna:
- `default_supplier_id` `uuid` nullable, FK `suppliers(id) ON DELETE SET NULL`.
- Índice `idx_ingredients_default_supplier` para o join da `list_ingredients`.

Sem mudança em RLS/GRANT (as tabelas já têm políticas ativas e são apenas colunas novas). Sem backfill: `default_supplier_id` começa `NULL` para todos os insumos e os campos de agenda começam vazios — o usuário preenche via UI/MCP.

## 2. Ferramentas MCP

### Novas (escrita)

- `update_ingredient_supplier({ ingredient_id, supplier_id | null })` — define/limpa o fornecedor padrão. Valida que o supplier pertence ao mesmo `restaurant_id` (via RLS).
- `create_supplier({ name, delivery_days?, order_days?, lead_time_days?, min_order_value?, notes? })` — cria fornecedor com agenda. Retorna o registro criado.
- `update_supplier({ supplier_id, name?, delivery_days?, order_days?, lead_time_days?, min_order_value?, notes? })` — patch parcial; só aplica campos enviados.

Todas com `annotations: { readOnlyHint: false }` e input Zod validando arrays de inteiros 0–6.

### Ajustes em ferramentas existentes

- **`list_suppliers`** — passar a retornar `delivery_days`, `order_days`, `lead_time_days`, `min_order_value`, `notes`.
- **`list_ingredients`** — adicionar `default_supplier_id` no select e fazer join leve `suppliers(id, name)` para expor `default_supplier: { id, name } | null`. Mantém o filtro `low_stock_only` já corrigido.
- **`get_product_stock`** — incluir `default_supplier` no retorno (mesmo shape).
- **`create_purchase_suggestion`** — mudanças:
  1. Agrupar por `default_supplier_id` do insumo (fallback: último fornecedor do histórico, e por fim "Sem fornecedor").
  2. Calcular o horizonte por grupo a partir da agenda do fornecedor: dado hoje + `order_days`/`delivery_days`/`lead_time_days`, cobrir o consumo até a **próxima entrega após a próxima** (ou até `horizon_days` se o fornecedor não tiver agenda). Assim uma sugestão de terça para um fornecedor que entrega ter/sex cobre até sexta.
  3. Marcar `at_risk: true` no item quando `days_remaining < dias_até_próxima_entrega` (o insumo zera antes do próximo pedido/entrega possível).
  4. Retornar o JSON estruturado completo em `structuredContent` **e** repetir o payload como texto (não só a frase-resumo), para o cliente MCP conseguir consumir programaticamente.
- **`get_low_stock`** — também repetir o array completo como texto, não só a contagem.

Sem mudanças em `create_purchase_order`, `get_supplier_products`, `suggest_purchase_quantity`.

## 3. UI (mínimo para o usuário conseguir preencher)

- **`ingredients.$id`**: campo select "Fornecedor padrão" listando `suppliers`.
- **`suppliers` (nova página ou seção existente, o que já houver)**: editor de `delivery_days` e `order_days` como toggles de dias da semana, inputs para `lead_time_days`, `min_order_value` e `notes`.

Se não houver hoje tela de gestão de fornecedores, criar `src/routes/_authenticated/suppliers.index.tsx` mínima (lista + form de edição inline). Confirmar antes da implementação se prefere que eu descubra e reuse a tela existente ou crie uma nova.

## 4. Verificação

- `bun run typecheck` (rodado pelo harness).
- Chamada MCP `list_suppliers` → confere colunas novas.
- Cadastrar 1 fornecedor com `order_days=[2]` e `delivery_days=[3,5]`, associar como default de 1 insumo, rodar `create_purchase_suggestion` numa terça → grupo agrupado pelo fornecedor certo, horizonte até sexta, `structuredContent` com array de itens.

## Detalhes técnicos

- Convenção de dias: `0=domingo … 6=sábado` (mesma de `Date.getUTCDay()`), documentada no `description` de cada tool.
- Cálculo da próxima entrega: função pura em `src/lib/mcp/lib/supplier-schedule.ts` recebendo `{ today, order_days, delivery_days, lead_time_days }` e retornando `{ next_order_date, next_delivery_date, coverage_days }`. Testável isoladamente.
- Fallback quando fornecedor não tem agenda: usa `horizon_days` do input (padrão 15) como hoje.
- `default_supplier_id` fica `NULL` para insumos sem fornecedor fixo (hortifruti) — a sugestão cai no grupo "Sem fornecedor" e o usuário decide na hora.
