// askGemini: the only way functions talk to the AI.
//
// Prompts are Markdown files in ./prompts/<name>.md with {{placeholders}}.
// A function that uses a prompt must ship the prompt files with it, by adding
// to supabase/config.toml:
//
//   [functions.<function-name>]
//   static_files = ["./functions/_shared/prompts/*.md"]
//
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-2.5-flash).

import { AiError, callGemini } from './gemini.ts';
import { fillPrompt, type PromptValue } from './template.ts';

export { AiError } from './gemini.ts';

/**
 * Temperature by prompt when the caller gives none (spec section 3): writing
 * questions needs some variety, reading dates and rating difficulty must not.
 */
const TEMPERATURE_BY_PROMPT: Record<string, number> = {
  'make-questions': 0.7,
  'read-syllabus': 0.2,
  'rate-difficulty': 0.2,
};

export interface AskOptions {
  /** Overrides the default for the prompt (0.7 for make-questions, 0.2 otherwise). */
  temperature?: number;
  /** Per attempt. Default 60 000 ms. */
  timeoutMs?: number;
}

/** Read prompts/<name>.md. Names are lowercase words joined by dashes. */
export async function loadPrompt(name: string): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`bad prompt name: ${name}`);
  return await Deno.readTextFile(new URL(`./prompts/${name}.md`, import.meta.url));
}

/**
 * Fill the prompt, ask Gemini for JSON that follows jsonSchema (Gemini's
 * responseSchema form: type 'OBJECT', 'ARRAY', 'STRING' ...), and return it
 * parsed. Throws AiError on any failure. The result is NOT validated against
 * the schema here: each caller checks the fields it uses and drops bad items.
 */
export async function askGemini<T>(
  promptName: string,
  variables: Record<string, PromptValue>,
  jsonSchema: object,
  options: AskOptions = {},
): Promise<T> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new AiError('ai_config', 'GEMINI_API_KEY is not set');
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
  const prompt = fillPrompt(await loadPrompt(promptName), variables);
  return await callGemini<T>({
    apiKey,
    model,
    prompt,
    schema: jsonSchema,
    temperature: options.temperature ?? TEMPERATURE_BY_PROMPT[promptName] ?? 0.2,
    timeoutMs: options.timeoutMs ?? 60_000,
  });
}
