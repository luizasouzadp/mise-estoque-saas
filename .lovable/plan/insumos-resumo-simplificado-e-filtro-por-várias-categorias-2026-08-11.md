# Insumos: resumo simplificado e filtro por várias categorias

## O que muda

**Resumo no topo**
- Remover os cards de Entradas e Saídas do período.
- Manter apenas o valor total do estoque (com a contagem de itens, abaixo do mínimo e zerados ao lado), recalculado conforme os filtros ativos.

**Filtros**
- Categoria passa a ser seleção múltipla: é possível marcar, por exemplo, Carnes e Hortifrúti ao mesmo tempo. Sem nenhuma marcada = todas.
- Data: um único campo "Estoque em" (data de referência). Os campos de período "de/até" saem.
- Busca por nome e "Mostrar inativos" continuam como estão.

**Exportação**
- O Excel passa a ter duas abas: Resumo (categorias selecionadas, data escolhida, itens e valor total) e Insumos (lista filtrada com estoque na data escolhida). A aba de Entradas e saídas é removida.

## Detalhes técnicos

- Arquivo: `src/routes/_authenticated/ingredients.index.tsx`.
- Trocar o estado `category: string` por `categories: string[]`, e remover `from`/`to` e o cálculo `periodMoves`.
- O helper `src/lib/stock-history.ts` continua sendo usado para reconstruir o estoque na data de referência (`stockAt`); nada muda nele nem no banco.
- Filtro de categoria por inclusão na lista selecionada, tratando itens sem categoria como "Sem categoria".
