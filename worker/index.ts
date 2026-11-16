// Cloudflare Worker: the API behind the page. The page itself is on GitHub Pages (PAGE below);
// the model key lives here as a secret, never in the browser.
//
//   POST /api/parse  { question }  ->  { draft, model, ms, cached? }
//   anything else    ->  301 to the same path on the page
//
// The Worker only returns the model's raw draft. Checking it against the game happens in
// shared code that the page runs, so a viewer sees exactly what the model said and what the
// code made of it.
//
// Spam protection: every question passes one Durable Object ("Guard"). Unlike a per-server
// counter it is a single instance for the whole world, so the limits below are exact no matter
// how many connections or Cloudflare locations a script uses:
//   - 30 requests a minute per visitor, cached or not,
//   - 10 model calls a minute and 100 a day per visitor,
//   - 1500 model calls a day in total: a hard ceiling on the daily bill.
// A question that was asked before is answered from the Guard's cache and costs nothing.

import gameJson from '../src/data/game.json';
import { parseModelOutput } from '../src/shared/check.ts';
import { DEFAULT_MODEL, DEFAULT_REASONING, FALLBACK_MODEL, draftFilter } from '../src/shared/llm.ts';
import { examples, systemPrompt } from '../src/shared/prompt.ts';
import type { Game } from '../src/shared/types.ts';

export const LIMITS = { perMinute: 30, modelPerMinute: 10, modelPerDay: 100, modelTotalPerDay: 1500 };

/** The public page. This Worker's own address only redirects there. */
const PAGE = 'https://oskarikaile.github.io/ask-the-game/';
/** Other sites whose pages may call the API (local dev calls it from the same origin). */
const ALLOWED_ORIGINS = [new URL(PAGE).origin];

// Minimal types for the bits of the Workers runtime used here (keeps the DOM types intact).
interface DOStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}
interface DOState { storage: DOStorage }
interface DOStub { fetch(url: string, init?: RequestInit): Promise<Response> }
interface DONamespace { idFromName(name: string): unknown; get(id: unknown): DOStub }
interface Ctx { waitUntil(p: Promise<unknown>): void }

interface Env {
  OPENROUTER_API_KEY?: string;
  /** Optional overrides (wrangler vars); the defaults live in src/shared/llm.ts. */
  MODEL?: string;
  /** reasoning effort for MODEL, e.g. "low" */
  MODEL_REASONING?: string;
  /** tried when MODEL fails or times out; "" = no backup */
  FALLBACK_MODEL?: string;
  GUARD: DONamespace;
}

interface Answer { draft: string; model: string; ms: number }
type Verdict = { ok: true } | { cached: Answer } | { deny: string };

const game = gameJson as unknown as Game;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** FNV-1a: a short id for the prompt, so a prompt change never serves old cached answers. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
const PROMPT_ID = hash(JSON.stringify([systemPrompt(game), examples(game)]));

const normalize = (q: string) =>
  q.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').replace(/[\s?!.]+$/, '').trim();

/** One visitor = one IPv4 address, or one /64 for IPv6 (a single home gets a whole /64). */
function visitor(req: Request): string {
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}

// ---------- the Guard (one instance, named "global") ----------

interface DayCount { date: string; total: number; ips: Record<string, number> }

export class Guard {
  private hits = new Map<string, number[]>(); // visitor -> request times in the last minute
  private calls = new Map<string, number[]>(); // visitor -> model-call times in the last minute
  private day?: DayCount;
  private state: DOState;

  constructor(state: DOState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const body = (await req.json()) as { op: 'check' | 'store'; ip?: string; key: string; value?: Answer };
    if (body.op === 'store') {
      await this.state.storage.put(`q:${body.key}`, body.value);
      return json({ ok: true });
    }
    return json(await this.check(body.ip ?? 'local', body.key));
  }

  private async check(ip: string, key: string): Promise<Verdict> {
    const now = Date.now();
    const lastMinute = (m: Map<string, number[]>) => {
      const times = (m.get(ip) ?? []).filter((t) => now - t < 60_000);
      m.set(ip, times);
      return times;
    };
    if (this.hits.size > 20_000) this.hits.clear();
    if (this.calls.size > 20_000) this.calls.clear();

    const hits = lastMinute(this.hits);
    if (hits.length >= LIMITS.perMinute) return { deny: 'That was a lot of questions in one minute. Wait a moment and try again.' };
    hits.push(now);

    const cached = await this.state.storage.get<Answer>(`q:${key}`);
    if (cached) return { cached };

    const calls = lastMinute(this.calls);
    if (calls.length >= LIMITS.modelPerMinute) return { deny: 'That was a lot of new questions in one minute. Wait a moment and try again.' };

    const today = new Date(now).toISOString().slice(0, 10);
    if (this.day?.date !== today) {
      const stored = await this.state.storage.get<DayCount>('day');
      this.day = stored?.date === today ? stored : { date: today, total: 0, ips: {} };
    }
    const day = this.day;
    if ((day.ips[ip] ?? 0) >= LIMITS.modelPerDay)
      return { deny: `You've asked ${LIMITS.modelPerDay} new questions today, the daily limit. The examples and "Edit by hand" still work.` };
    if (day.total >= LIMITS.modelTotalPerDay)
      return { deny: 'The demo has used its question budget for today. The examples and "Edit by hand" still work.' };

    calls.push(now);
    day.total += 1;
    day.ips[ip] = (day.ips[ip] ?? 0) + 1;
    await this.state.storage.put('day', day);
    return { ok: true };
  }
}

// ---------- the Worker ----------

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/api/parse') return Response.redirect(new URL(url.pathname.slice(1) + url.search, PAGE).href, 301);

    // Only the demo page may call the API from a browser: same origin (local dev) or the allowed sites.
    const origin = req.headers.get('origin');
    const crossSite = origin !== null && origin !== url.origin;
    if (crossSite && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Ask from the demo page.' }, 403);

    const res =
      req.method === 'OPTIONS'
        ? new Response(null, { status: 204 }) // the browser's CORS preflight for the JSON POST
        : await answer(req, env, ctx);
    if (crossSite) {
      res.headers.set('access-control-allow-origin', origin);
      res.headers.set('access-control-allow-methods', 'POST');
      res.headers.set('access-control-allow-headers', 'content-type');
      res.headers.set('access-control-max-age', '86400');
      res.headers.set('vary', 'origin');
    }
    return res;
  },
};

/** POST /api/parse: the Guard first (limits + cache), then the model, then the backup model. */
async function answer(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  let question = '';
  try {
    question = String(((await req.json()) as { question?: unknown }).question ?? '').trim();
  } catch {
    return json({ error: 'Send JSON: { "question": "..." }' }, 400);
  }
  if (!question) return json({ error: 'Ask a question first.' }, 400);
  if (question.length > 300) return json({ error: 'Keep the question under 300 characters.' }, 400);

  const model = env.MODEL || DEFAULT_MODEL;
  const key = `${PROMPT_ID}|${model}|${normalize(question)}`;
  const guard = env.GUARD.get(env.GUARD.idFromName('global'));
  const ask = (body: object) => guard.fetch('https://guard/', { method: 'POST', body: JSON.stringify(body) });

  const verdict = (await (await ask({ op: 'check', ip: visitor(req), key })).json()) as Verdict;
  if ('deny' in verdict) return json({ error: verdict.deny }, 429);
  if ('cached' in verdict) return json({ ...verdict.cached, cached: true });
  if (!env.OPENROUTER_API_KEY) return json({ error: 'The model key is not set on the server.' }, 500);

  const effort = env.MODEL ? env.MODEL_REASONING : DEFAULT_REASONING;
  const fallback = env.FALLBACK_MODEL ?? FALLBACK_MODEL;
  const tries = [{ model, reasoning: effort ? { effort } : undefined }];
  if (fallback && fallback !== model) tries.push({ model: fallback, reasoning: undefined });

  for (const t of tries) {
    try {
      const a = await draftFilter(question, game, { apiKey: env.OPENROUTER_API_KEY, ...t, timeoutMs: 10_000 });
      const result: Answer = { draft: a.text, model: a.model, ms: a.ms };
      console.log(JSON.stringify({ question, ...result, cost: a.cost }));
      // only cache answers that are at least a JSON object, so one bad answer never sticks
      if (!parseModelOutput(a.text).error) ctx.waitUntil(ask({ op: 'store', key, value: result }));
      return json(result);
    } catch (err) {
      console.error(t.model, String(err));
    }
  }
  return json({ error: 'The model did not answer. Try again, or edit the filter by hand.' }, 502);
}
