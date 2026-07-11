
# Compra por foto da nota fiscal

Nova rota `/purchases/new-from-photo` que aceita a foto (ou PDF) de uma nota, extrai fornecedor + itens + quantidades + valores, sugere o insumo do seu cadastro para cada linha, aplica regras de conversão de unidade que você mesmo ensina, e abre uma tela de conferência antes de gravar como compra.

## Fluxo do usuário

1. Em Compras, botão **"Adicionar por foto da nota"** ao lado de "Nova compra".
2. Tela de upload: foto do celular, arquivo da galeria ou colar imagem. Se a nota tiver QR Code NFC-e, o app tenta ler o QR primeiro (leitura oficial, mais precisa). Se não achar QR, cai para leitura por IA visual.
3. Progresso: "Lendo nota…", "Casando com seu cadastro…".
4. Tela de conferência:
   - Cabeçalho: fornecedor detectado (com opção de trocar/criar), data da nota, total.
   - Uma linha por item extraído com:
     - Texto original da nota (ex.: `SACO LIXO 100L PT10`)
     - Insumo sugerido do seu cadastro (com % de confiança) — trocável via combo pesquisável
     - Quantidade na nota + unidade da nota (ex.: `1 PT`)
     - Regra de conversão aplicada (ex.: `1 PT = 10 un`) → quantidade final em `un`
     - Preço unitário na nota e preço unitário convertido (ex.: `R$ 30 / PT → R$ 3,00 / un`)
     - Botão "Editar" e "Remover"
   - Se aparecer uma unidade nova para aquele insumo, aparece um aviso amarelo: *"Ensinar conversão: 1 PT = __ un"*, e ao salvar a compra a regra fica guardada para as próximas notas.
   - Linhas sem correspondência ficam destacadas com "Escolher insumo" ou "Cadastrar novo".
5. Botão **"Registrar compra"** grava tudo em `purchases` (dispara as triggers de estoque que já existem) e salva a imagem da nota anexada.

## Ensinar convers\u00f5es

- Nova tabela `ingredient_unit_aliases` por insumo: `from_unit` (o que veio na nota, ex.: `PT`, `CX`, `FD10`) → `factor` (quantos da unidade cadastrada tem em 1 dessa embalagem).
- Preenchida de três formas:
  - Automaticamente quando você confirma uma regra na tela de conferência.
  - Manualmente na tela do insumo (nova seção "Embalagens conhecidas").
  - Editando a linha da compra e marcando "Salvar essa conversão para as próximas".
- O parser sempre normaliza `nota → unidade cadastrada`: quantidade × fator; custo unitário ÷ fator. É o mesmo padrão do `convertIngredientUnit` já existente, só que aplicado no momento da importação.

## Corresp\u00f3ndencia de insumos (sugerir e confirmar)

- Para cada linha da nota, calcular score contra o cadastro do restaurante usando:
  1. Match direto no histórico (`purchase_import_matches`): se já confirmei antes "SACO LIXO 100L PT10" → esse insumo, sugerir com confiança máxima.
  2. Similaridade textual (`pg_trgm` — extensão nativa do Postgres) sobre `ingredients.name`.
  3. Boost quando a unidade da nota ou algum alias conhecido do insumo bate.
- Tela sempre mostra a sugestão mas exige confirmação (padrão escolhido: "Sugerir e eu confirmo"). Ao confirmar, gravamos `purchase_import_matches` para aprender.

## Fornecedor

- Se a nota trouxer CNPJ, procurar em `suppliers.tax_id` (novo campo opcional). Se não achar, oferecer "Criar fornecedor **X — CNPJ Y**".
- Se só tiver nome, sugerir por similaridade e permitir criar novo.

## Imagem anexada

- Bucket privado `purchase-invoices` no Storage. Cada compra registrada por foto guarda `purchases.invoice_image_path` (novo campo). Signed URL de 1h ao visualizar.

## Extra\u00e7\u00e3o

Dois caminhos, escolhidos automaticamente:

- **QR NFC-e**: decodifica o QR na imagem (client-side com `jsQR`), extrai a URL da SEFAZ, e uma `createServerFn` (`parseNfceQrUrl`) baixa a página oficial da nota e faz o parsing dos itens. Sem IA envolvida — dados 100% oficiais.
- **OCR via IA visual**: se não achar QR, `createServerFn` (`parseInvoiceImage`) manda a imagem para `google/gemini-3-pro` via Lovable AI Gateway com `Output` estruturado (Zod schema: `{ supplier, tax_id, purchased_at, items: [{ raw_text, quantity, unit, unit_price, total }] }`).

Ambas rotas retornam o mesmo formato e alimentam a mesma tela de conferência.

## Detalhes t\u00e9cnicos

### Migra\u00e7\u00f5es

1. `alter table suppliers add column tax_id text;` (índice único por restaurante quando não nulo)
2. `alter table purchases add column invoice_image_path text, add column source text default 'manual';`
3. Nova tabela `ingredient_unit_aliases (id, restaurant_id, ingredient_id, from_unit, factor, created_by, created_at)` com RLS por restaurante e GRANTs padrão.
4. Nova tabela `purchase_import_matches (id, restaurant_id, raw_text_normalized, ingredient_id, hits, last_used_at)` — chave `(restaurant_id, raw_text_normalized)` — para aprender correspondências.
5. `create extension if not exists pg_trgm;` + índice GIN em `ingredients.name`.
6. Bucket privado `purchase-invoices` (via `storage_create_bucket`) + policies em `storage.objects` restritas ao restaurante do usuário.

### C\u00f3digo

- `src/routes/_authenticated/purchases.import.tsx` — upload + tela de conferência.
- `src/lib/invoice-import.functions.ts`:
  - `parseNfceQrUrl({ url })` — fetch da SEFAZ + parse HTML.
  - `parseInvoiceImage({ imagePath })` — chama Lovable AI Gateway com Gemini vision, retorna schema estruturado.
  - `suggestIngredientMatches({ items })` — roda pg_trgm + histórico e devolve top 3 por linha.
  - `saveImportedPurchase({ header, items, learnAliases, learnMatches })` — grava purchases, aliases novos e matches.
- `src/lib/mcp/tools/import-invoice-from-image.ts` — expor a mesma funcionalidade como ferramenta MCP (mesma resposta estruturada, `needsApproval: true`).
- Botão novo em `src/routes/_authenticated/purchases.index.tsx`.
- Seção "Embalagens conhecidas" na página do insumo (`ingredients.$id.tsx`) para gerenciar aliases manualmente.

### Regra de convers\u00e3o (recap)

Dado alias `1 <from_unit> = factor <base_unit>`:
- `quantity_base = quantity_nota × factor`
- `unit_cost_base = unit_cost_nota ÷ factor`
- `total_cost` da compra = `quantity_nota × unit_cost_nota` (não muda)

## Escopo n\u00e3o inclu\u00eddo

- Cadastro em massa de aliases via CSV.
- Aprendizado global entre restaurantes (matches ficam por restaurante).
- Leitura de XML de NFe (só QR + OCR nesta versão).
