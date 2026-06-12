## Problema

A tabela "Saída real x teórica por insumo" já está implementada, mas só é acessível pelo diálogo "Comparar CMV real x teórico", que abre por um botão de ícone (⚖️) na coluna de ações da tabela **CMV salvos**. Isso tem dois problemas:

1. Quem só calcula o CMV de um período (sem clicar em "Salvar") nunca vê o botão.
2. O botão é apenas um ícone sem rótulo, fácil de passar despercebido.

## Mudanças propostas (somente UI na página `/cmv`)

1. **Botão visível no resultado do cálculo atual**
   - No card de resultado do CMV calculado (onde já aparecem Custo, Faturamento, CMV %), adicionar um botão claro com rótulo: **"Comparar com CMV teórico"** (ícone Scale + texto).
   - Ao clicar, abre o mesmo diálogo já existente, usando o período/custo/faturamento atualmente calculado (sem precisar salvar antes).

2. **Rótulo no botão da tabela "CMV salvos"**
   - Trocar o `Button size="icon"` por um botão com ícone + texto curto ("Comparar"), mantendo a mesma ação. Assim quem usa a lista de salvos também identifica a função.

3. **Sem mudanças de lógica**
   - Reaproveita o estado `compareReport`, o diálogo e o componente `IngredientDiffsTable` já existentes.
   - Sem mudanças em queries, schema ou cálculos.

## Resultado

A comparação CMV real x teórico e o detalhamento "Saída real x teórica por insumo" passam a ser descobertos com um clique a partir do próprio cálculo, sem depender de salvar o relatório nem de identificar um ícone isolado.