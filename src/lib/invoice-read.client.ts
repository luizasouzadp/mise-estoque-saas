import { supabase } from "@/integrations/supabase/client";
import type { ParsedInvoiceData } from "@/lib/invoice-read.server";

// Chama /api/invoice-read e espera a resposta final, ignorando os "pings" que o
// servidor manda para manter a conexão viva enquanto a IA lê a nota.
export async function readInvoice(imageDataUrls: string[]): Promise<ParsedInvoiceData> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Entre de novo no app.");

  let res: Response;
  try {
    res = await fetch("/api/invoice-read", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ imageDataUrls }),
    });
  } catch {
    throw connectionLost();
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Falha ao ler a nota (${res.status}).`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const event = JSON.parse(line) as
          | { type: "ping" }
          | { type: "result"; data: ParsedInvoiceData }
          | { type: "error"; message: string };
        if (event.type === "result") return event.data;
        if (event.type === "error") throw new Error(event.message);
      }
      if (done) break;
    }
  } catch (e) {
    if (e instanceof SyntaxError || /load failed|failed to fetch|network/i.test((e as Error)?.message ?? "")) {
      throw connectionLost();
    }
    throw e;
  }
  throw connectionLost();
}

function connectionLost() {
  return new Error(
    "A conexão caiu enquanto a IA lia a nota. Confira a internet, mantenha o app aberto e tente de novo.",
  );
}
