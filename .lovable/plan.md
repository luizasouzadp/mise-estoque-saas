
## Análise de Vendas do Cardápio

Nova página acessível pela aba **Cardápio** (`/pricing`) via botão "Análise de Vendas", em rota dedicada `/menu-analysis` (lista de relatórios) e `/menu-analysis/$id` (relatório detalhado).

### 1. Importação da planilha

- Botão "Nova análise" abre diálogo para:
  - Selecionar mês/ano de referência
  - Upload de arquivo `.xlsx` ou `.csv`
- Detecção automática de formato:
  - **Mínimo**: colunas `codigo` + `quantidade`
  - **Completo**: `codigo` + `quantidade` + `preco_unitario`
- Cabeçalhos tolerantes (código/cod/sku, qtd/quantidade, preço/valor)
- Parsing com `xlsx` (SheetJS) no browser
- Cada `codigo` é casado contra `menu_products.product_code` E `recipes.product_code` (somente itens com `is_on_menu`)
- Itens não encontrados ficam listados como "Códigos não mapeados" no relatório (sem bloquear)

### 2. Persistência

Duas tabelas novas:

- `sales_reports`: mês de referência, nome do arquivo, totais agregados, parecer IA, criado_por
- `sales_report_items`: linhas da planilha vinculadas ao item resolvido (menu_product_id ou recipe_id), quantidade, preço unitário usado, custo unitário usado, faturamento, custo total, margem
- `sales_report_unmapped`: códigos não encontrados + quantidade

RLS por restaurante seguindo padrão existente.

### 3. Cálculos por linha

- **Preço unitário**: do arquivo se presente; senão `current_price` do item
- **Custo unitário**: `cost` (menu_products) ou `recipe_unit_cost(recipe_id)` (recipes)
- **Faturamento** = preço × quantidade
- **Custo total** = custo × quantidade
- **Margem absoluta** = faturamento − custo total
- **Margem %** = margem / faturamento
- **CMV %** = custo total / faturamento

### 4. Relatório (página `/menu-analysis/$id`)

Seções com componentes `recharts` (já no projeto):

1. **Resumo geral**: faturamento, CMV global, margem total, nº de itens vendidos
2. **Pizza — Faturamento por categoria**
3. **Pizza/Barras — CMV % por categoria**
4. **Top itens por categoria** (tabs por categoria, top 5 cada)
5. **Matriz BCG do cardápio** (scatter chart: eixo X = quantidade vendida, eixo Y = margem %):
   - **Campeões** (alta venda + alta margem)
   - **Tesouros escondidos** (baixa venda + alta margem)
   - **Queridinhos** (alta venda + baixa margem)
   - **Problemas** (baixa venda + baixa margem)
   - Critério: **média** do próprio relatório como linha divisória (quantidade média e margem % média)
   - Tabela abaixo agrupando itens por quadrante
6. **Parecer geral por IA** (Lovable AI Gateway, `google/gemini-3-flash-preview`):
   - Server function `generateSalesInsights` recebe os dados agregados (resumo + categorias + matriz) e devolve texto em markdown
   - Renderizado com `react-markdown` (já usado? se não, adicionar)
   - Botão "Regenerar parecer"
7. **Códigos não mapeados** (se houver)

### 5. Lista de relatórios `/menu-analysis`

Tabela com mês, data de criação, faturamento, CMV%, ações (abrir / excluir).

### Detalhes técnicos

- **Frontend**: novas rotas `src/routes/_authenticated/menu-analysis.index.tsx` e `menu-analysis.$id.tsx`; botão na `pricing.index.tsx`
- **Parsing**: `bun add xlsx`
- **Markdown**: `bun add react-markdown` (se ainda não houver)
- **Server functions** em `src/lib/sales-reports.functions.ts`:
  - `createSalesReport({ month, items })` — resolve códigos, calcula, persiste, dispara IA
  - `generateSalesInsights({ reportId })` — chama Lovable AI e salva parecer
  - `deleteSalesReport({ id })`
- **IA**: helper `src/lib/ai-gateway.server.ts` (padrão Lovable AI Gateway), prompt em PT-BR pedindo parecer estruturado com pontos de atenção e sugestões por quadrante
- **Migration**: 3 tabelas + GRANTs + RLS (`current_restaurant_id()` / `is_manager_or_owner`)
- **Chefs** continuam sem acesso (rota só aparece para owner/manager — já filtrado pelo AppShell)

### Fora de escopo

- Edição manual de linhas após importar (refazer com nova planilha)
- Comparativo mês-a-mês (pode vir depois)
- Mapeamento manual de códigos não encontrados (apenas exibidos)
