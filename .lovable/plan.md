# Leitura de nota por foto com sua própria chave Google Gemini

## Objetivo

Parar de usar a IA nativa do Lovable (créditos do plano) nessa funcionalidade e passar a chamar a API do Google Gemini diretamente com uma chave sua, cobrada na sua conta Google.

## Observação importante sobre "Edge Function"

Este projeto usa TanStack Start: a lógica de servidor já roda em funções de servidor do próprio app (é o equivalente à Edge Function aqui). A função de leitura de nota já existe e roda no servidor — vou adaptá-la em vez de criar uma Edge Function nova, mantendo o mesmo comportamento e o mesmo formato de resposta.

## O que será feito

1. **Secret `GEMINI_API_KEY`**
   Vou solicitar o secret pelo formulário seguro do Lovable. Você cola a chave gerada no Google AI Studio (formato `AIza...`). Ela fica disponível apenas no servidor, nunca no navegador.

2. **Trocar a chamada de IA** (`src/lib/invoice-import.functions.ts`)
   - Remover o uso do AI Gateway do Lovable nessa função (nenhum consumo de crédito Lovable).
   - Chamar direto `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent` com a `GEMINI_API_KEY`.
   - Enviar as imagens como `inlineData` (suporta várias páginas, como hoje) mais o prompt de extração.
   - Usar resposta estruturada (`responseMimeType: application/json` + schema) pedindo: fornecedor, CNPJ, data da nota, itens (descrição, quantidade, unidade, valor unitário, valor total) e valor total da nota.
   - Validar a resposta com o mesmo schema Zod atual, para o frontend continuar recebendo exatamente o formato que já espera.

3. **Erros claros em português**
   - Sem chave configurada, chave inválida (401/403), limite atingido (429), cota/billing, nota ilegível ou JSON inválido → mensagem específica exibida no app.

4. **Frontend**
   `purchases.import.tsx` continua chamando a mesma função (`parseInvoiceImage`), então não muda o fluxo da tela. Só ajusto mensagens se necessário.

5. **Total da nota**
   O formato atual não tem o campo "valor total da nota". Vou adicioná-lo à resposta e exibi-lo na tela de conferência, sem alterar o resto da importação.

## Detalhes técnicos

- Arquivo alterado: `src/lib/invoice-import.functions.ts` (handler `parseInvoiceImage`).
- Data URLs recebidas do frontend são convertidas em `{ inlineData: { mimeType, data } }`.
- `process.env.GEMINI_API_KEY` lido dentro do handler.
- `src/lib/ai-gateway.server.ts` permanece, pois outras funções (análise de vendas) ainda usam o gateway — se você quiser, migro essas depois também.

## Onde colar a chave

Depois da implementação: o formulário seguro aparece aqui no chat pedindo `GEMINI_API_KEY` — basta colar e salvar. Depois ela também fica visível/editável em Configurações do projeto → Secrets.
