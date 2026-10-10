// The one place that talks to the Gemini REST API. Pure apart from fetch and
// timers (both exist in Node too), so vitest can test it with a fake fetch.
// ai.ts wraps it with the Deno-only parts: secrets and prompt files.

export type AiErrorCode =
  | 'ai_config' // GEMINI_API_KEY missing
  | 'ai_timeout' // no answer within the time limit, twice
  | 'ai_network' // could not reach Gemini, twice
  | 'ai_http' // Gemini answered with an error status
  | 'ai_blocked' // Gemini refused the prompt or stopped for safety
  | 'ai_empty' // an answer with no text
  | 'ai_bad_json'; // text that is not JSON

/** Any failure talking to the AI. http.ts turns it into a 502 answer. */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface GeminiRequest {
  apiKey: string;
  model: string;
  prompt: string;
  /** The shape the answer must follow, in Gemini's responseSchema form (type: 'OBJECT', 'STRING', ...). */
  schema: object;
  /** 0.2 for reading syllabuses and rating difficulty, 0.7 for writing questions. */
  temperature: number;
  /** Per attempt. Default 60 000. */
  timeoutMs?: number;
  /** Pause before the one retry. Default 1 000; tests pass 0. */
  retryDelayMs?: number;
  /** Injected in tests. Default: the global fetch. */
  fetchFn?: typeof fetch;
}

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

interface GeminiAnswer {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
}

/**
 * Send one prompt, get back parsed JSON. Retries once when Gemini cannot be
 * reached, times out, or answers 429 or 5xx. Never retries a bad answer.
 * The caller must still check the shape of what comes back.
 */
export async function callGemini<T>(req: GeminiRequest): Promise<T> {
  const fetchFn = req.fetchFn ?? fetch;
  const url = `${API}/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
    generationConfig: {
      temperature: req.temperature,
      responseMimeType: 'application/json',
      responseSchema: req.schema,
    },
  });

  let lastError: AiError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) await sleep(req.retryDelayMs ?? 1000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      lastError = controller.signal.aborted
        ? new AiError('ai_timeout', `Gemini did not answer within ${req.timeoutMs ?? 60_000} ms`)
        : // Deno's fetch errors include the URL, and the URL carries the key: hide it.
          new AiError('ai_network', `could not reach Gemini: ${String(e).replaceAll(req.apiKey, '[key]')}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // The URL carries the key, so only the answer text goes into the message.
      const detail = (await res.text()).slice(0, 500);
      lastError = new AiError('ai_http', `Gemini answered ${res.status}: ${detail}`, res.status);
      if (RETRY_STATUSES.has(res.status)) continue;
      throw lastError;
    }
    return readAnswer<T>((await res.json()) as GeminiAnswer);
  }
  throw lastError ?? new AiError('ai_network', 'Gemini call failed');
}

function readAnswer<T>(answer: GeminiAnswer): T {
  const blocked = answer.promptFeedback?.blockReason;
  if (blocked) throw new AiError('ai_blocked', `Gemini refused the prompt: ${blocked}`);
  const candidate = answer.candidates?.[0];
  const reason = candidate?.finishReason;
  if (reason && reason !== 'STOP' && reason !== 'MAX_TOKENS') {
    throw new AiError('ai_blocked', `Gemini stopped early: ${reason}`);
  }
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (text.trim() === '') throw new AiError('ai_empty', 'Gemini returned no text');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiError('ai_bad_json', `Gemini returned text that is not JSON: ${text.slice(0, 200)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
