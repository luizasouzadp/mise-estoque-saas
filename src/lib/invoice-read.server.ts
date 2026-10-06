import { z } from "zod";

// Leitura da nota fiscal por foto via Google Gemini (só roda no servidor).
// Os modelos mais novos às vezes omitem campos vazios ou mandam números como texto
// ("3,50"); aceita tudo isso em vez de recusar a nota inteira.
const num = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return v;
}, z.number().nullable());
const str = z.preprocess(
  (v) => (v === undefined || v === null ? null : typeof v === "number" ? String(v) : v),
  z.string().nullable(),
);
const ItemSchema = z.object({
  raw_text: z.string(),
  quantity: num,
  unit: str,
  unit_price: num,
  total: num,
});
const ParsedInvoice = z.object({
  supplier: str,
  tax_id: str,
  purchased_at: str,
  invoice_total: num,
  items: z.preprocess(
    // Descarta linhas sem descrição em vez de falhar a nota toda.
    (v) =>
      Array.isArray(v)
        ? v.filter((it) => it && typeof it.raw_text === "string" && it.raw_text.trim())
        : v,
    z.array(ItemSchema),
  ),
});

// Modelos atuais primeiro; o 2.5 fica de reserva (o Google já recusa ele para algumas chaves).
const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"];
// Notas longas podem levar mais de um minuto; a rota /api/invoice-read mantém a
// conexão do celular viva enquanto isso (senão o Safari desiste e mostra "Load failed").
const ATTEMPT_TIMEOUT_MS = 100_000;
const TOTAL_BUDGET_MS = 160_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PROMPT = `Extraia todos os itens desta nota fiscal brasileira (NFC-e, cupom fiscal ou nota de fornecedor em papel). A nota pode ter várias páginas — considere TODAS as imagens em conjunto como uma única nota.

Retorne JSON estrito no formato:
- supplier: nome/razão social do emitente (string ou null)
- tax_id: CNPJ do emitente (apenas dígitos, sem pontos/barra) ou null
- purchased_at: data de emissão em ISO 8601 (YYYY-MM-DDTHH:mm:ss) ou null
- invoice_total: valor total da nota em R$ (numérico) ou null
- items: array de linhas de produto (de TODAS as páginas), para cada uma:
  - raw_text: descrição EXATA como aparece na nota (inclua marca, tamanho, embalagem)
  - quantity: quantidade numérica (use ponto decimal)
  - unit: unidade como aparece (un, UN, KG, kg, L, LT, ML, PT, PCT, CX, FD, DZ, etc.)
  - unit_price: preço unitário em R$ (numérico, ponto decimal)
  - total: subtotal da linha em R$ (numérico)

Regras:
- Não invente linhas. Só retorne o que estiver visível.
- Ignore linhas de desconto, subtotal geral, frete, tributos.
- Se a nota mostrar "2 x 3,50 = 7,00", quantity=2, unit_price=3.50, total=7.00.
- Se unidade não aparecer, use "un".
- Números com vírgula na nota devem virar ponto no JSON.
- Não repita itens que aparecem em mais de uma página (por exemplo continuação).`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    supplier: { type: "STRING", nullable: true },
    tax_id: { type: "STRING", nullable: true },
    purchased_at: { type: "STRING", nullable: true },
    invoice_total: { type: "NUMBER", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          raw_text: { type: "STRING" },
          quantity: { type: "NUMBER", nullable: true },
          unit: { type: "STRING", nullable: true },
          unit_price: { type: "NUMBER", nullable: true },
          total: { type: "NUMBER", nullable: true },
        },
        required: ["raw_text"],
      },
    },
  },
  required: ["items"],
} as const;

function dataUrlToInlinePart(url: string) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url.trim());
  if (!match) {
    throw new Error("Formato de imagem inválido. Reenvie a foto da nota.");
  }
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

export type ParsedInvoiceData = z.infer<typeof ParsedInvoice>;

export async function readInvoiceWithGemini(urls: string[]): Promise<ParsedInvoiceData> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Chave da API do Google (GEMINI_API_KEY) não configurada. Adicione o secret nas configurações do projeto.",
    );
  }

  const parts = [{ text: PROMPT }, ...urls.map(dataUrlToInlinePart)];

  const buildBody = (model: string) =>
    JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        // Sem "pensar" longamente: a leitura da nota é uma tarefa direta e isso acelera muito.
        thinkingConfig:
          model === "gemini-2.5-flash" ? { thinkingBudget: 0 } : { thinkingLevel: "minimal" },
      },
    });

  let res: Response | null = null;
  let lastBody = "";
  let timedOut = false;
  const startedAt = Date.now();
  // Tenta cada modelo; em sobrecarga (5xx) repete uma vez, em limite (429) passa logo ao próximo.
  outer: for (const model of GEMINI_MODELS) {
    const requestBody = buildBody(model);
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
      if (remaining < 5_000) break outer;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: requestBody,
            signal: AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining)),
          },
        );
      } catch (e) {
        res = null;
        // Demorou demais: não adianta repetir o mesmo modelo, passa ao próximo.
        if ((e as Error)?.name === "TimeoutError") {
          timedOut = true;
          console.error(`[Gemini/${model}] tempo esgotado`);
          break;
        }
        await sleep(1000);
        continue;
      }
      if (res.ok) break outer;
      lastBody = await res.text().catch(() => "");
      console.error(`[Gemini/${model}] ${res.status}: ${lastBody.slice(0, 500)}`);
      if (res.status === 404 || res.status === 429) break;
      if (res.status < 500) break outer;
      if (attempt < 1) await sleep(1000);
    }
  }

  if (!res) {
    if (timedOut) {
      throw new Error(
        "A IA do Google demorou demais para ler a nota. Tente novamente em instantes ou envie menos fotos por vez.",
      );
    }
    throw new Error("Não foi possível conectar à API do Google. Tente novamente.");
  }

  if (!res.ok) {
    const body = lastBody;
    if (res.status >= 500) {
      throw new Error(
        "A IA do Google está sobrecarregada no momento (erro 503). Aguarde alguns instantes e tente ler a nota novamente.",
      );
    }
    if (res.status === 400 && /API key not valid/i.test(body)) {
      throw new Error("Chave da API do Google inválida. Verifique o secret GEMINI_API_KEY.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Acesso negado pela API do Google. Confira se a chave é válida e tem a API Generative Language habilitada.",
      );
    }
    if (res.status === 429) {
      if (/limit:\s*0/.test(body)) {
        throw new Error(
          "Sua chave do Google está com cota ZERO para este modelo (limite gratuito não liberado no projeto Google da chave). Ative o faturamento (billing) no projeto Google Cloud dessa chave ou gere uma nova chave no Google AI Studio em um projeto com nível gratuito habilitado.",
        );
      }
      throw new Error("Limite de uso do Google atingido. Aguarde alguns segundos e tente de novo.");
    }
    if (res.status === 402 || /billing|quota/i.test(body)) {
      throw new Error("Cota/faturamento da sua conta Google impediu a leitura. Verifique no Google AI Studio.");
    }
    if (res.status === 404) {
      throw new Error("O modelo de IA do Google não está disponível para esta chave. Gere uma nova chave no Google AI Studio.");
    }
    throw new Error(`Falha ao ler a nota na API do Google (${res.status}).`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  if (json.promptFeedback?.blockReason) {
    throw new Error("A imagem foi bloqueada pela API do Google. Envie outra foto da nota.");
  }

  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) {
    console.error("[Gemini] resposta vazia:", JSON.stringify(json).slice(0, 800));
    throw new Error("A IA não devolveu nenhum texto da nota. Tente uma foto mais nítida ou reenquadre.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("Não consegui interpretar a nota. Tente uma foto mais nítida.");
    }
    try {
      raw = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new Error("Não consegui interpretar a nota. Tente uma foto mais nítida.");
    }
  }

  const parsed = ParsedInvoice.safeParse(raw);
  if (!parsed.success) {
    console.error("[Gemini] resposta fora do schema:", parsed.error.message, text.slice(0, 800));
    throw new Error("Não consegui ler a nota. Tente uma foto mais nítida ou reenquadre.");
  }
  if (!parsed.data.items.length) {
    throw new Error("Nenhum item foi identificado na nota. Tente uma foto mais nítida.");
  }
  return parsed.data;
}
