/**
 * Thin wrapper over Sarvam AI's chat completions endpoint.
 * Docs: POST {base}/v1/chat/completions, header `api-subscription-key`.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const BASE = process.env.SARVAM_BASE_URL || "https://api.sarvam.ai";
const MODEL = process.env.SARVAM_MODEL || "sarvam-105b";

export function hasKey(): boolean {
  return Boolean(process.env.SARVAM_API_KEY && process.env.SARVAM_API_KEY.trim());
}

export type SarvamResult =
  | { ok: true; content: string }
  | { ok: false; status: number; message: string };

export async function sarvamChat(messages: ChatMessage[], maxTokens = 900): Promise<SarvamResult> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    return { ok: false, status: 503, message: "SARVAM_API_KEY is not set." };
  }

  try {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-subscription-key": key,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
      // never let a hung upstream hold the request open
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        message: `Sarvam API returned ${res.status}. ${body.slice(0, 300)}`,
      };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { ok: false, status: 502, message: "Sarvam API returned an empty response." };
    }
    return { ok: true, content };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, status: 502, message: `Could not reach Sarvam: ${message}` };
  }
}
