import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readInvoiceWithGemini } from "@/lib/invoice-read.server";

// Lê a nota por IA mandando um sinal ("ping") a cada poucos segundos enquanto o
// Google trabalha. Sem isso, o Safari do celular desiste da conexão depois de
// ~60s sem receber nada e mostra "Load failed". Resposta: uma linha JSON por evento.
const PING_EVERY_MS = 5_000;

const Body = z.object({ imageDataUrls: z.array(z.string().min(30)).min(1).max(10) });

async function authenticate(request: Request): Promise<boolean> {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) return false;
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  return !error && !!data?.claims?.sub;
}

export const Route = createFileRoute("/api/invoice-read")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authenticate(request))) {
          return Response.json({ error: "Sessão expirada. Entre de novo no app." }, { status: 401 });
        }
        const parsedBody = Body.safeParse(await request.json().catch(() => null));
        if (!parsedBody.success) {
          return Response.json({ error: "Envie ao menos uma imagem." }, { status: 400 });
        }

        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        const writer = writable.getWriter();
        const send = (event: object) =>
          writer.write(encoder.encode(JSON.stringify(event) + "\n")).catch(() => {});

        const work = (async () => {
          await send({ type: "ping" });
          const timer = setInterval(() => void send({ type: "ping" }), PING_EVERY_MS);
          try {
            const data = await readInvoiceWithGemini(parsedBody.data.imageDataUrls);
            await send({ type: "result", data });
          } catch (e) {
            await send({ type: "error", message: (e as Error).message || "Falha ao ler a nota." });
          } finally {
            clearInterval(timer);
            await writer.close().catch(() => {});
          }
        })();
        void work;

        return new Response(readable, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            // no-transform: impede a Cloudflare de comprimir/segurar os pings.
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
