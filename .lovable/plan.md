# Corrigir insumos aparecendo com consumo real zerado na comparação de CMV

## Diagnóstico

Ao investigar os itens citados ("Molho de tomate da casa", "Suco de laranja", "Skol beats"), encontrei o seguinte no banco:

- **Molho de tomate da casa** — é uma sub-receita estocada (`source_recipe_id` preenchido). Tem `stock_movements` de saída no período (ex.: 1,317 em 06/07, 1,15 em 29/06 etc.).
- **Skol beats** e **Suco de laranja** — insumos comuns, com `composes_cmv = true`, e têm saídas registradas (ex.: 29/06).

Todos os três aparecem zerados na tabela **"Saída real x teórica por insumo"** do diálogo *Comparar CMV real x teórico* (`src/routes/_authenticated/cmv.index.tsx`).

### Causa raiz 1 — falso positivo em "preparo intermediário" (afeta o Molho de tomate)

A função `computeIntermediatePrepSet` (linhas ~48–79) marca um preparo estocado como *intermediário* sempre que ele é consumido pela ficha de **outro** preparo estocado. O molho de tomate é usado dentro do "Molho de camarão 200g" (que também é estocado) **e** diretamente em várias pizzas (que não são estocadas).

O filtro atual descarta 100% das saídas do molho de tomate, mesmo quando essas saídas correspondem ao consumo direto nas pizzas. Resultado: real = 0.

A regra correta é: só tratar como intermediário quando o preparo é **exclusivamente** consumido por outros preparos estocados. Se ele também é usado em pelo menos uma ficha que não é um preparo estocado (ex.: uma pizza no cardápio), suas saídas continuam sendo consumo real.

### Causa raiz 2 — período da comparação (afeta Skol beats e Suco de laranja)

A saída real é buscada em `stock_movements` filtrada por `report.period_start`/`period_end`. A última saída da Skol beats e do Suco de laranja está em **29/06/2026**. Se o relatório de CMV comparado tem período posterior (ex.: 01–06/07), esses itens naturalmente aparecem com real = 0 — não é bug, é ausência real de saídas no intervalo escolhido.

Isso é importante checar antes de qualquer mudança: preciso confirmar com você o **período do relatório de CMV** em que percebeu o problema, para separar "bug" de "período sem movimentação".

## Alterações propostas

Arquivo: `src/routes/_authenticated/cmv.index.tsx`

1. **Reescrever `computeIntermediatePrepSet`** para marcar um preparo como intermediário apenas quando **todos** os usos dele em `recipe_items` estão dentro de outras receitas que são preparos estocados. Basta um uso em receita não-estocada (pizza, prato do cardápio) para o preparo voltar a contar como consumo real.

2. **Nenhuma outra mudança de lógica** — mantém filtros de `production:` em insumos crus, mantém `composes_cmv`, mantém o cálculo teórico.

3. Depois do ajuste, verificar no preview que a linha do "Molho de tomate da casa" na tabela de comparação passa a mostrar quantidade real (>0) quando há saídas no período do relatório.

## Pendência antes de implementar

Confirme, por favor: **qual o período do relatório de CMV** em que você abriu a comparação? Isso decide se o Skol beats e o Suco de laranja também precisam de correção ou se só o Molho de tomate se encaixa no bug descrito acima.
