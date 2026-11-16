// One call to the model through OpenRouter. Used by the Worker and by the eval script,
// so both run the exact same prompt.

import { examples, systemPrompt } from './prompt.ts';
import type { Game } from './types.ts';

// Picked by `npm run eval` (evals/results.md): 28/28 on three runs, ~1 s, about half the cost of
// Claude Haiku 5.5. Haiku (also 28/28) is the backup when DeepSeek fails or times out.
export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';
export const DEFAULT_REASONING = 'low'; // reasoning off is unreliable for this model
export const FALLBACK_MODEL = 'anthropic/claude-haiku-5.5';

export interface ModelOptions {
  apiKey: string;
  model?: string;
  /** OpenRouter reasoning settings, for example { effort: 'low' } */
  reasoning?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ModelAnswer {
  text: string;
  model: string;
  ms: number;
  cost?: number;
}

export async function draftFilter(question: string, game: Game, opts: ModelOptions): Promise<ModelAnswer> {
  const messages = [
    { role: 'system', content: systemPrompt(game) },
    ...examples(game).flatMap((ex) => [
      { role: 'user', content: ex.q },
      { role: 'assistant', content: JSON.stringify(ex.a) },
    ]),
    { role: 'user', content: question },
  ];
  const model = opts.model ?? DEFAULT_MODEL;
  const started = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      'content-type': 'application/json',
      'x-title': 'Ask the game (demo)',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      usage: { include: true },
      ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as any;
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error(`empty answer (${data.choices?.[0]?.finish_reason ?? 'no choices'})`);
  return { text, model: data.model ?? model, ms: Date.now() - started, cost: data.usage?.cost };
}
