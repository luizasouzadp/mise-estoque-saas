# Resumo e filtros na aba de Insumos

Adicionar no topo da página de Insumos um painel de resumo com totais, valor do estoque, entradas e saídas do período, com filtros por data e categoria, e exportação em Excel conforme o filtro.

## Painel de resumo

Cards no topo da lista, recalculados sempre que os filtros mudam:

- **Itens** — quantidade de insumos considerados no filtro.
- **Valor em estoque** — soma de (estoque × custo médio) na data escolhida.
- **Entradas no período** — quantidade de lançamentos, quantidade total e valor em R$.
- **Saídas no período** — quantidade de lançamentos, quantidade total e valor em R$.
- **Abaixo do mínimo / zerados** — contagem rápida.

## Filtros

- **Categoria** — lista das categorias existentes (com opção "Todas").
- **Período (de / até)** — define a janela de entradas e saídas.
- **Data de referência** — "ver estoque como estava em", que reconstrói o estoque naquela data.
- Busca por nome e o interruptor "Mostrar inativos" continuam funcionando junto com os novos filtros.

Quando uma data de referência é escolhida, cada card de insumo passa a mostrar o estoque daquela data (e o valor correspondente), com um aviso visual de que é uma visão histórica.

## Estoque em data passada

O estoque histórico é reconstruído a partir do estoque atual, revertendo todas as movimentações posteriores à data escolhida — compras, movimentações manuais/produção e ajustes de inventário concluídos —, a mesma base já usada na tela de Movimentações.

## Exportação

Botão "Exportar" gera um arquivo Excel com o que está filtrado:

- Aba **Insumos**: nome, categoria, unidade, estoque (na data de referência), custo médio, valor total, estoque mínimo, situação.
- Aba **Entradas e saídas**: data, insumo, categoria, tipo, origem (compra, produção, inventário, manual), quantidade, valor.
- Aba **Resumo**: os mesmos totais mostrados nos cards, com o filtro aplicado descrito.

## Detalhes técnicos

- Arquivo principal: `src/routes/_authenticated/ingredients.index.tsx`.
- Nova consulta que carrega, além de `ingredients`: `purchases`, `stock_movements`, `production_items` e `inventory_items` de inventários concluídos, unificados em uma lista de movimentos (mesma lógica de `movements.index.tsx`, extraída para um helper compartilhado em `src/lib/`).
- Valor de cada movimento: `unit_cost` quando existir, senão `avg_cost` do insumo; produções usam a soma dos insumos consumidos.
- Datas tratadas em fuso local com o helper `parseLocal` já usado nas outras telas, para evitar o desvio de um dia.
- Exportação via `xlsx` (já instalado), sem alteração de banco de dados.
