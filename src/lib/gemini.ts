import type { ZodType, ZodTypeDef } from "zod";

const API = "https://generativelanguage.googleapis.com/v1beta/models";

export class AIError extends Error {
  constructor(
    public code:
      | "no_key"
      | "timeout"
      | "blocked"
      | "invalid_output"
      | "rate_limited"
      | "upstream",
    message: string,
  ) {
    super(message);
  }
}

type CallOpts<T> = {
  system: string;
  prompt: string;
  schema: object; // Gemini responseSchema (OpenAPI subset)
  validate: ZodType<T, ZodTypeDef, unknown>;
  /** extra checks after zod; return a problem description to trigger a retry */
  check?: (v: T) => string | null;
  temperature?: number;
  timeoutMs?: number;
};

/** Ordered fallback chain. Benchmarked 19 Nov 2026 on the store prompt: 3.5 Flash-Lite
 *  answers in 3–8s; full 3.5 Flash took >25s, so speed wins for a phone user waiting. */
function models(): string[] {
  const list = (
    process.env.GEMINI_MODELS ||
    "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3-flash-preview"
  )
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set(list)];
}

async function callOnce(
  model: string,
  opts: CallOpts<unknown>,
  extra: string,
  timeoutMs: number,
) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIError("no_key", "GEMINI_API_KEY is not set");

  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    responseSchema: opts.schema,
    temperature: opts.temperature ?? 0.9,
    maxOutputTokens: 4096,
  };
  // Models "think" by default; for short structured copy deep thinking mostly adds latency.
  if (model.includes("2.5"))
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  else
    generationConfig.thinkingConfig = {
      thinkingLevel: process.env.GEMINI_THINKING || "minimal",
    };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API}/${model}:generateContent`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.prompt + extra }] }],
        generationConfig,
      }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError")
      throw new AIError("timeout", `${model} timed out`);
    throw new AIError("upstream", `${model} network error`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429)
    throw new AIError("rate_limited", `${model} rate limited`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AIError(
      "upstream",
      `${model} HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const json = await res.json();
  if (json?.promptFeedback?.blockReason)
    throw new AIError("blocked", json.promptFeedback.blockReason);
  const cand = json?.candidates?.[0];
  if (
    cand?.finishReason === "SAFETY" ||
    cand?.finishReason === "PROHIBITED_CONTENT"
  )
    throw new AIError("blocked", "safety");
  const text: string = (cand?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text)
    throw new AIError(
      "invalid_output",
      `${model} returned no text (${cand?.finishReason})`,
    );
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError("invalid_output", `${model} returned malformed JSON`);
  }
}

/**
 * Structured generation with quality control:
 * 1. Ask the primary model for JSON that matches a schema.
 * 2. Validate with zod + business checks. If it fails, retry once and tell the
 *    model exactly what was wrong.
 * 3. If a model is down, slow or rate-limited, fall back to the next one in the chain;
 *    if all are busy, wait briefly and try the chain once more.
 */
export async function generateJSON<T>(
  opts: CallOpts<T>,
): Promise<{ data: T; model: string; attempts: number }> {
  const deadline = Date.now() + (opts.timeoutMs ?? 45000);
  let attempts = 0;
  let lastErr: unknown = null;

  // Two passes over the model chain: free-tier Gemini returns short "high demand"
  // 503s in bursts, so if every model is busy we wait a moment and go round once more.
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      const busy =
        lastErr instanceof AIError &&
        (lastErr.code === "upstream" || lastErr.code === "rate_limited");
      if (!busy || deadline - Date.now() < 12000) break;
      await new Promise((r) => setTimeout(r, 1500));
      console.warn("[ai] all models busy, second pass");
    }
    for (const model of models()) {
      let feedback = "";
      for (let i = 0; i < 2; i++) {
        const remaining = deadline - Date.now();
        if (remaining < 3000) throw new AIError("timeout", "out of time");
        attempts++;
        try {
          const t0 = Date.now();
          const raw = await callOnce(
            model,
            opts as CallOpts<unknown>,
            feedback,
            Math.min(remaining, 25000),
          );
          console.log(
            `[ai] ${model} ok in ${Date.now() - t0}ms (attempt ${attempts})`,
          );
          const parsed = opts.validate.safeParse(raw);
          if (!parsed.success) {
            const issues = parsed.error.issues
              .slice(0, 5)
              .map((x) => `${x.path.join(".")}: ${x.message}`);
            throw new AIError("invalid_output", issues.join("; "));
          }
          const problem = opts.check?.(parsed.data);
          if (problem) throw new AIError("invalid_output", problem);
          return { data: parsed.data, model, attempts };
        } catch (e) {
          lastErr = e;
          console.warn(
            `[ai] ${model} attempt ${attempts} failed: ${(e as Error).message?.slice(0, 160)}`,
          );
          if (e instanceof AIError) {
            if (e.code === "no_key" || e.code === "blocked") throw e;
            if (e.code === "invalid_output") {
              feedback = `\n\nIMPORTANT: your previous answer was rejected because: ${e.message}. Fix this and answer again.`;
              continue; // retry same model with feedback
            }
          }
          break; // timeout / rate limit / upstream: move to the fallback model
        }
      }
    }
  }
  if (lastErr instanceof AIError) throw lastErr;
  throw new AIError("upstream", String(lastErr));
}
