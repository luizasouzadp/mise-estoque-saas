
## Objetivo
Renomear e mover a tela atual "Vendas diárias & alerta de compra" para dentro do fluxo de Compras como **Lista de compras**, restringir aos insumos abaixo do mínimo (sem pré-preparos), permitir upload de vendas por dia único ou por período, renomear/ajustar as listas locais e criar uma página real de **Encomendas** (persistida no banco) agrupada por fornecedor com envio por WhatsApp para os contatos internos salvos.

## Escopo

### 1. Renomear e mover a rota
- Novo arquivo `src/routes/_authenticated/purchases.shopping-list.tsx` (rota `/purchases/shopping-list`) com o conteúdo migrado de `cmv.daily.tsx`.
- Título passa a ser **"Lista de compras"**; subtítulo curto sobre alerta baseado em estoque projetado.
- Em `src/routes/_authenticated/purchases.index.tsx`: novo botão **"Lista de compras"** ao lado de "Notas" / "Nova compra".
- Em `src/routes/_authenticated/cmv.index.tsx`: remover o card/link "Vendas diárias & alerta de compra".
- `cmv.daily.tsx` removido.

### 2. Filtrar apenas insumos abaixo do mínimo, sem pré-preparos
- A tabela de alerta passa a mostrar apenas `status ∈ { zerado, abaixo_minimo }`, excluindo insumos com `ingredients.source_recipe_id IS NOT NULL` (pré-preparos gerados a partir de fichas técnicas). Filtro aplicado no client após `projected_stock_status` (com um `select id from ingredients where source_recipe_id is not null` para obter os IDs a excluir).
- Cards de resumo passam a ser 2 (Zerados / Abaixo do mínimo).

### 3. Upload de vendas por dia único ou período
- No `NewDailyReportDialog` migrado: toggle **"Dia único" / "Período"**.
    - Dia único: comportamento atual.
    - Período: dois campos (`start_date`, `end_date`). Um `daily_sales_reports` é criado para cada dia do intervalo, com quantidades/faturamento divididos igualmente por N dias e `file_name` sufixado com o intervalo.
- `src/lib/daily-sales.functions.ts`: nova server fn `createDailySalesReportRange({ start_date, end_date, file_name, rows })` que reusa a lógica de `createDailySalesReport` iterando pelos dias.

### 4. Renomear "lista do dia seguinte" → "compras emergenciais" com auto-remoção
- Rótulos, títulos de dialog, toasts e mensagem WhatsApp trocados para **"Compras emergenciais"**.
- `localStorage` mantido (`cmv.purchase-lists.v1`), migração idempotente da chave `nextDay` → `emergency`.
- **Auto-remoção**: aplicar o mecanismo já usado para `ordered` também à lista `emergency` — consultar `purchases` com `ingredient_id IN (…)` e `purchased_at >= addedAt`; ao detectar compra, remover da lista emergencial.

### 5. Lista de encomendas: remover ao marcar como encomendado
- Já ocorre hoje (ao adicionar em `ordered`, sai de `orders`). Preservar esse comportamento agora que "ordered" passa a ir para o banco.

### 6. "Já encomendado" persistente → nova página `/purchases/orders`

**Banco (uma migration):**
- Nova tabela `public.purchase_orders`:
    - `id uuid pk`, `restaurant_id uuid fk`, `supplier_id uuid fk suppliers`, `ingredient_id uuid fk ingredients`, `quantity numeric`, `unit text`, `expected_at date`, `status text check in ('pending','received','cancelled') default 'pending'`, `notes text`, `created_by uuid`, `created_at`, `updated_at`.
    - GRANTs padrão, RLS por `current_restaurant_id()`, trigger `set_updated_at`.
- **Sem alteração em `suppliers`** — o WhatsApp usa os contatos internos já cadastrados em `whatsapp_contacts` (equipe de recebimento), não o telefone do fornecedor.

**Fluxo do botão "Já encomendado":**
- Substitui o `window.prompt` atual por um `Dialog` com: fornecedor (select entre os cadastrados em `ingredient_suppliers` do insumo + qualquer fornecedor + opção "outro/livre"), quantidade, unidade (default = unidade do insumo), previsão de chegada (`expected_at`), observação.
- Ao confirmar: `insert into purchase_orders` (status=pending), remove das listas locais `emergency` e `orders`, invalida queries.

**Nova rota `/purchases/orders`** (`src/routes/_authenticated/purchases.orders.tsx`):
- Lista `purchase_orders` com `status='pending'`, **agrupadas por fornecedor** (nome + resumo dos dias de entrega do fornecedor).
- Cada linha: insumo, quantidade + unidade, previsão de chegada, ações (**Recebido** → `status='received'`; **Cancelar**; editar quantidade/data inline).
- Cabeçalho do grupo com botão **"Enviar por WhatsApp"** → abre picker dos **contatos salvos em `whatsapp_contacts`** (mesmo padrão do inventário) para escolher o funcionário que vai receber a ordem; monta mensagem no formato:
    ```
    *Ordem de compra — {fornecedor}*
    {data}

    • {insumo}: {qty} {unit} (prev. {expected_at})
    ...
    Total de itens: N
    ```
- Auto-baixa: quando uma compra é lançada (em `purchases.new.tsx` e `purchases.import.tsx`) para um insumo com ordem `pending` do mesmo fornecedor, marcar automaticamente `status='received'`. Implementado via server fn `settlePurchaseOrders({ ingredient_ids, supplier })` chamada após insert nos dois pontos de entrada de compras.
- Botão **"Encomendas"** adicionado em `purchases.index.tsx`.

### 7. Ajustes de UI relacionados
- Na "Lista de compras", remover a seção separada `alertOrdered` (encomendados agora ficam em `/purchases/orders`). Adicionar banner no topo com contagem de encomendas pendentes e link para `/purchases/orders`.
- Manter botão "Enviar vendas do dia" (agora dia único ou período) e histórico de uploads.

## Detalhes técnicos

- **Rotas**: novas `purchases.shopping-list.tsx`, `purchases.orders.tsx`; removida `cmv.daily.tsx`.
- **Migration**: create `purchase_orders` (grants + RLS + trigger).
- **Server fns**:
    - `src/lib/daily-sales.functions.ts`: adiciona `createDailySalesReportRange`.
    - `src/lib/purchase-orders.functions.ts` (novo): `createPurchaseOrder`, `updatePurchaseOrderStatus`, `settlePurchaseOrders`.
- **localStorage**: manter `emergency` e `orders`; remover `ordered` (migrado para banco). Migração `nextDay → emergency` idempotente.
- **Filtro pré-preparo**: `ingredients.source_recipe_id IS NOT NULL`.
- **WhatsApp**: link `https://wa.me/55<numero>?text=<encoded>` para contatos internos (`whatsapp_contacts`), mesmo padrão do inventário.

## Fora de escopo
- Não altera `projected_stock_status`.
- Não envia WhatsApp para o fornecedor — só para contatos internos.
- Não cria histórico separado de encomendas recebidas nesta fase.
