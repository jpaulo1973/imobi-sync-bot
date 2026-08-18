// Adaptador de IA multi-transporte.
//
// Transporte 1 (default em Lovable): Lovable AI Gateway via LOVABLE_API_KEY.
// Transporte 2 (BYOK, ex.: Vercel):  API OpenAI direta via OPENAI_API_KEY.
//
// A assinatura de callLovableAI() não muda — os 6 módulos consumidores
// (property-import, whatsapp-leads, dedup-ai, search-splitter,
// location-normalize, match.functions) continuam iguais.

const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// Default suportado para o transporte BYOK (OpenAI direto).
const DEFAULT_OPENAI_MODEL = "gpt-5-nano";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

type Transport = "openai" | "lovable";

function resolveTransport(): Transport {
  const explicit = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "openai") return "openai";
  if (explicit === "lovable") return "lovable";
  // Auto: dentro de Lovable (LOVABLE_API_KEY presente) mantém o gateway;
  // fora (ex.: Vercel) usa a chave própria OpenAI se existir.
  if (process.env.LOVABLE_API_KEY) return "lovable";
  return process.env.OPENAI_API_KEY ? "openai" : "lovable";
}

/** Modelos do gateway vêm no formato "vendor/model"; a API OpenAI só aceita o id nu. */
function toOpenAIModel(model: string | undefined): string {
  const configured = (process.env.AI_MODEL ?? "").trim();
  if (configured) return configured.replace(/^openai\//, "");
  if (!model) return DEFAULT_OPENAI_MODEL;
  // Modelos de outros vendors (ex.: google/gemini-*) não existem na OpenAI:
  // cai para o default suportado.
  if (!model.startsWith("openai/")) return DEFAULT_OPENAI_MODEL;
  return model.replace(/^openai\//, "");
}

function missingKeyError(which: "LOVABLE_API_KEY" | "OPENAI_API_KEY"): Error {
  if (which === "OPENAI_API_KEY") {
    return new Error(
      "OPENAI_API_KEY não está configurada. " +
        "Vercel: Project → Settings → Environment Variables → OPENAI_API_KEY (Production + Preview) e faz redeploy. " +
        "Lovable Cloud: a chave é gerida automaticamente (LOVABLE_API_KEY), não precisa desta variável.",
    );
  }
  return new Error(
    "LOVABLE_API_KEY não está configurada. " +
      "Em Lovable Cloud esta chave é provisionada automaticamente. " +
      "Fora de Lovable (ex.: Vercel) configura em vez disso OPENAI_API_KEY " +
      "(Project → Settings → Environment Variables, Production + Preview) e faz redeploy.",
  );
}

export async function callLovableAI(opts: {
  model?: string;
  messages: ChatMessage[];
  response_format?: { type: "json_object" };
}): Promise<string> {
  const transport = resolveTransport();

  let url: string;
  let headers: Record<string, string>;
  let model: string;

  if (transport === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw missingKeyError("OPENAI_API_KEY");
    url = OPENAI_URL;
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    model = toOpenAIModel(opts.model);
  } else {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw missingKeyError("LOVABLE_API_KEY");
    url = LOVABLE_GATEWAY_URL;
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    model = opts.model ?? "google/gemini-2.5-flash";
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: opts.messages,
      ...(opts.response_format ? { response_format: opts.response_format } : {}),
    }),
  });

  if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (res.status === 429) throw new Error("RATE_LIMITED");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI error (${transport}) ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
