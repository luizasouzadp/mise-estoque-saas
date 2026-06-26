## Plano de ajuste

### Contexto
Na tela `/purchases/new`, o botão **+ Adicionar item** atualmente fica no topo da seção de itens, alinhado ao rótulo "Itens". O usuário quer que o botão apareça **abaixo do último item adicionado**, facilitando o fluxo de adicionar vários insumos sequencialmente.

### Arquivo a alterar
- `src/routes/_authenticated/purchases.new.tsx`

### Mudança
1. Remover o botão "+ Adicionar item" do cabeçalho da seção de itens (linhas 177–181).
2. Inserir o botão logo após o mapeamento da lista de itens (`{items.map(...)}`), ainda dentro do contêiner `space-y-3` dos itens, para que fique diretamente abaixo do último item.
3. Manter o visual e comportamento atuais: variant `outline`, tamanho `sm`, ícone `Plus` e ação `setItems((p) => [...p, newItem()])`.
4. Ajustar o cabeçalho para que o rótulo "Itens" permaneça alinhado à esquerda sem o botão ao lado.

### Validação
- Build do projeto para garantir que não há erros de sintaxe.
- Verificar visualmente no preview que o botão aparece abaixo do último item e ainda adiciona novos itens normalmente.