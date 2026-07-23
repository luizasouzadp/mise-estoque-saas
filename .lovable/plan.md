## Objetivo

Na tela "Compra por foto da nota", permitir ampliar a imagem da nota para conferir item a item enquanto revisa o que a IA extraiu.

## Mudanças

Arquivo: `src/routes/_authenticated/purchases.import.tsx`

1. Tornar a miniatura já existente (linha ~347) clicável — cursor de zoom e `title="Clique para ampliar"`.
2. Adicionar um `Dialog` (shadcn) controlado por um novo estado `zoomOpen`:
   - Conteúdo largo (`max-w-5xl`), com a imagem em `max-h-[85vh] w-auto object-contain` e permitindo scroll.
   - Fechar clicando fora ou no X padrão do Dialog.
3. Após a IA ler a nota, manter a mesma miniatura visível ao lado do bloco "Itens extraídos" para que o usuário possa reabrir a ampliação a qualquer momento durante a revisão — adicionar uma miniatura pequena (clicável, mesmo comportamento) no cabeçalho do card "Itens extraídos (N)".

Sem mudanças de backend, banco ou lógica de importação — apenas visualização.
