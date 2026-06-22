## Problema

A importação atual exige cabeçalho ("codigo", "quantidade", etc.). Sua planilha não tem cabeçalho — as linhas começam direto com os dados (ex.: `106;17`, `211;1`), por isso aparece "A planilha precisa ter coluna de código e quantidade".

## Solução

Atualizar o diálogo **Nova análise** em `src/routes/_authenticated/menu-analysis.index.tsx` para aceitar planilhas sem cabeçalho, com mapeamento manual de colunas.

### Mudanças no diálogo de importação

1. **Checkbox "Planilha sem cabeçalho"** (marcado por padrão se a primeira linha parecer dados numéricos).
2. **Seletores de coluna** quando "sem cabeçalho" estiver marcado:
   - Coluna do **código** (padrão: A)
   - Coluna da **quantidade** (padrão: B)
   - Coluna do **preço unitário** (opcional, padrão: nenhuma)
3. **Pré-visualização** das 3 primeiras linhas lidas, mostrando qual valor virou código/quantidade/preço — para o usuário conferir antes de importar.

### Lógica de leitura

- Trocar `XLSX.utils.sheet_to_json(sheet, { defval: "" })` por `sheet_to_json(sheet, { header: 1, defval: "" })` quando "sem cabeçalho" estiver marcado — isso devolve um array de arrays (linhas brutas), independente de nomes de colunas.
- Mapear cada linha pelas posições escolhidas (A=0, B=1, etc.).
- Pular linhas totalmente vazias e ignorar linhas onde `quantidade <= 0` ou código vazio (já é o comportamento atual).
- Manter o caminho automático (com cabeçalho) para planilhas que já vêm rotuladas.

### Sem mudanças no backend

A função `createSalesReport` continua igual — ela já recebe `rows: [{ product_code, quantity, unit_price? }]`. Toda a mudança é na leitura no cliente.

## Arquivo afetado

- `src/routes/_authenticated/menu-analysis.index.tsx` — apenas o componente `NewReportDialog`.
