# Usuário de recebimento de mercadorias

Criar um novo tipo de usuário ("Recebimento") que só enxerga a página de **Encomendas**. Ele confirma o que chegou e anexa fotos das notas — mas nunca dá entrada no estoque. As notas ficam pendentes para o usuário com acesso total finalizar.

## O que o usuário de recebimento pode fazer

- Entrar no app e ver apenas a página **Encomendas** (qualquer outra rota redireciona para lá).
- Ver as encomendas por fornecedor, marcar itens que chegaram e confirmar recebimento anexando foto(s) da nota + observação de avaria (fluxo que já existe hoje).
- **Novo:** enviar foto de uma nota avulsa (compra que chegou sem encomenda lançada), informando fornecedor e observação. Essa nota entra na mesma fila de "notas aguardando entrada".
- Não pode: dar entrada por foto, editar estoque, ver compras, insumos, CMV, fichas, etc.

## O que o usuário com acesso total continua fazendo

- Vê o card "Notas aguardando entrada" na aba de Compras, agora somando as notas de encomendas **e** as notas avulsas enviadas pelo recebimento.
- Ao clicar, abre a leitura da nota por foto já com as imagens carregadas, confere e dá a entrada de fato. A nota sai da fila.

## Como criar o usuário

Na tela de Produção já existe a gestão de chefs (criar usuário/senha, listar, resetar senha, excluir). A mesma tela ganha uma segunda seção **"Usuários de recebimento"** com as mesmas ações. Login é feito por nome de usuário e senha, igual ao chef.

## Detalhes técnicos

**Banco (migração)**
- Adicionar valor `receiver` ao enum `app_role`.
- Nova tabela `pending_invoices`: `restaurant_id`, `supplier_name`, `notes`, `image_paths text[]`, `status` (`pending` | `imported`), `created_by`, timestamps. GRANTs para `authenticated`/`service_role`, RLS por `current_restaurant_id()`.
- Políticas para o papel `receiver`: leitura/atualização de `purchase_orders` do próprio restaurante (status/recebimento), leitura de `suppliers` e `ingredients`, insert em `pending_invoices`. Sem acesso de escrita a `purchases`/`stock_movements`.
- Storage: policy no bucket `purchase-invoices` permitindo upload por usuários do restaurante (inclui receiver).

**Frontend**
- `src/hooks/use-roles.ts` e `src/lib/roles.ts`: expor `isReceiver` (papel único `receiver`) além de `isChef`.
- `src/routes/_authenticated.tsx` + `src/components/AppShell.tsx`: se `isReceiver`, navegação só com "Encomendas" e redirect para `/purchases/orders`.
- `src/routes/login.tsx`: após login, receiver vai para `/purchases/orders`.
- `src/routes/_authenticated/purchases.orders.tsx`: novo botão "Enviar nota avulsa" (fornecedor + fotos/PDF + observação → `pending_invoices`); esconder ações de criação/edição de encomenda para receiver se necessário, mantendo confirmar recebimento.
- `src/routes/_authenticated/purchases.index.tsx`: card de pendências passa a unir `purchase_orders` com `import_status = 'pending'` e `pending_invoices` com `status = 'pending'`.
- `src/routes/_authenticated/purchases.import.tsx`: aceitar origem `pending_invoice` (carregar imagens do registro) e, ao concluir a entrada, marcar como `imported`.

**Server functions**
- `src/lib/chefs.functions.ts` generalizado para criar/listar/excluir/resetar senha também para o papel `receiver` (mesmo padrão de e-mail sintético, sufixo próprio), mantendo a checagem `is_manager_or_owner`.
