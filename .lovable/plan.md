## Objetivo

Ao confirmar o recebimento de uma encomenda, capturar a foto da nota e observações (avarias). A foto entra no arquivo mensal de notas e uma pendência aparece nas Compras, abrindo o fluxo "Compra por foto da nota" já com a imagem carregada para dar entrada da mercadoria.

## Mudanças

### 1. Banco (migration)
Adicionar em `purchase_orders`:
- `receipt_image_path text` — caminho da foto no bucket `purchase-invoices`.
- `receipt_notes text` — observações de avaria.
- `received_at timestamptz` — momento do recebimento.
- `import_status text default 'pending'` — `'pending' | 'imported' | 'skipped'`.
- `imported_purchase_ids uuid[]` — IDs das compras criadas ao dar entrada.

Backfill: registros antigos com `status='received'` recebem `import_status='skipped'` para não gerarem pendência retroativa.

### 2. Encomendas (`purchases.orders.tsx`)
- Substituir o botão "Confirmar recebimento" (e o ícone verde por linha) por um diálogo único que:
  - Mostra os itens que serão recebidos.
  - Aceita foto da nota (câmera ou galeria) e um campo "Observações / avarias".
  - Ao salvar: faz upload no bucket `purchase-invoices` e atualiza as linhas selecionadas com `status='received'`, `received_at`, `receipt_image_path`, `receipt_notes`, `import_status='pending'` (mesmo `receipt_image_path` para todas as linhas do lote, para que representem uma nota só).
- Foto e observação são obrigatórias para "Confirmar recebimento" do grupo. A ação por linha (✓) permanece como recebimento rápido sem nota (marcada `import_status='skipped'`), para casos avulsos.

### 3. Pendências na aba de Compras (`purchases.index.tsx`)
- Nova query que busca `purchase_orders` com `import_status='pending'` agrupadas por `receipt_image_path`.
- Renderizar um bloco "Notas aguardando entrada" acima dos filtros: um card por nota mostrando fornecedor, data do recebimento, miniatura da foto, quantidade de itens, observação. Botão "Dar entrada" leva para `/purchases/import?fromOrderReceipt=<receipt_image_path>`.
- Botão secundário "Ignorar" marca as linhas como `import_status='skipped'`.

### 4. Arquivo de notas (`purchases.notes.tsx`)
- Query adicional em `purchase_orders` filtrando `receipt_image_path not null`.
- Fundir com a lista atual (chave = `receipt_image_path`), evitando duplicar quando a mesma foto já foi importada e virou linhas em `purchases`. Fornecedor / data / total vêm de `purchases` quando existir, senão do `purchase_orders` (sem valor total).
- Export ZIP passa a incluir também as fotos vindas somente das encomendas.

### 5. Importação por foto (`purchases.import.tsx`)
- Ler search param `fromOrderReceipt` (caminho no storage).
- Quando presente: baixar a imagem do bucket via `createSignedUrl` + `fetch`, converter em `File`, preencher `file`/`preview` automaticamente e disparar `parseMut` para o usuário só revisar/salvar.
- Após salvar com sucesso, atualizar as linhas de `purchase_orders` com aquele `receipt_image_path`: `import_status='imported'`, `imported_purchase_ids` com os IDs retornados por `saveImportedPurchase`.
- Requer que `saveImportedPurchase` retorne os IDs das compras criadas (ajuste em `src/lib/invoice-import.functions.ts` se hoje não retorna).

### Detalhes técnicos
- Route search validation com `validateSearch` para tipar `fromOrderReceipt`.
- Signed URLs de 1h reutilizadas via mesma técnica de `purchases.notes.tsx`.
- Sem alteração em RLS (encomendas já são user-scoped via `restaurant_id`).
- Sem novo bucket: reutiliza `purchase-invoices`.
