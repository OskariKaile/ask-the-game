// Runs every eval question through the real prompt + the real check, for each model.
//
//   node evals/run.ts                                     all models below
//   node evals/run.ts deepseek/deepseek-v4.1-flash@low    one model (@ = reasoning effort)
//
// Needs OPENROUTER_API_KEY in the environment or in .dev.vars. Writes evals/results.md.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { checkDraft } from '../src/shared/check.ts';
import { draftFilter } from '../src/shared/llm.ts';
import type { CheckedFilter, Game } from '../src/shared/types.ts';
import { CASES, type Case, type Want } from './cases.ts';

const game = JSON.parse(readFileSync('src/data/game.json', 'utf8')) as Game;
const key =
  process.env.OPENROUTER_API_KEY ??
  (existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8').match(/OPENROUTER_API_KEY=(.+)/)?.[1]?.trim() : undefined);
if (!key) throw new Error('OPENROUTER_API_KEY missing');

// Models on the command line: `vendor/model` or `vendor/model@low` (reasoning effort).
const MODELS: { model: string; reasoning?: Record<string, unknown> }[] = process.argv[2]
  ? process.argv.slice(2).map((arg) => {
      const [model, effort] = arg.split('@');
      return effort ? { model, reasoning: { effort } } : { model };
    })
  : [
      { model: 'deepseek/deepseek-v4.1-flash', reasoning: { effort: 'low' } }, // used
      { model: 'anthropic/claude-haiku-5.5' }, // backup
      { model: 'z-ai/glm-5.3-flash' },
      { model: 'deepseek/deepseek-v4-flash-0731', reasoning: { effort: 'low' } },
      { model: 'inclusionai/ling-3.0-flash' },
      { model: 'mistralai/mistral-small-3.2-24b-instruct' },
      { model: 'qwen/qwen3.7-flash' },
      { model: 'openai/gpt-oss-20b', reasoning: { effort: 'low' } },
      { model: 'openai/gpt-5-nano', reasoning: { effort: 'low' } },
      { model: 'google/gemma-4-26b-a4b-it' },
    ];

const id = (last: string) => game.players.find((p) => p.last === last)?.id;

function expand(w: Want): CheckedFilter {
  return {
    events: [...(w.events ?? [])].sort(),
    players: (w.players ?? []).map((n) => id(n)!).sort(),
    playerRole: w.playerRole ?? 'primary',
    periods: w.periods ?? [],
    strength: w.strength ?? [],
    side: w.side,
    goalie: w.goalie ? id(w.goalie) : undefined,
    from: w.from,
    to: w.to,
    goaliePulled: w.goaliePulled,
    minXg: w.minXg,
    scoreState: w.scoreState,
  };
}
const canon = (f: CheckedFilter) =>
  JSON.stringify({ ...expand({}), ...f, events: [...f.events].sort(), players: [...f.players].sort(), strength: [...f.strength].sort() });

interface Row { q: string; pass: boolean; got: string; ms: number; cost: number }

async function runCase(c: Case, m: (typeof MODELS)[number]): Promise<Row> {
  try {
    const a = await draftFilter(c.q, game, { apiKey: key!, model: m.model, reasoning: m.reasoning, timeoutMs: 40000 });
    const r = checkDraft(a.text, game);
    let pass: boolean;
    if (c.error) pass = !r.ok && r.checks.some((x) => x.level === 'error' && c.error!.test(x.message));
    else pass = r.ok && [c.want!, ...(c.alts ?? [])].some((w) => canon(expand(w)) === canon(r.filter));
    return { q: c.q, pass, got: a.text.replace(/\s+/g, ' ').slice(0, 220), ms: a.ms, cost: a.cost ?? 0 };
  } catch (err) {
    return { q: c.q, pass: false, got: `ERROR ${String(err).slice(0, 160)}`, ms: 0, cost: 0 };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const median = (xs: number[]) => {
  const s = xs.filter((x) => x > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

const lines: string[] = [`# Eval results (${new Date().toISOString().slice(0, 10)})`, '', `${CASES.length} questions, see evals/cases.ts.`, ''];
lines.push('| Model | Correct | Median latency | Cost per question |', '|---|---|---|---|');
const details: string[] = [];
for (const m of MODELS) {
  const rows = await pool(CASES, 4, (c) => runCase(c, m));
  const ok = rows.filter((r) => r.pass).length;
  const cost = rows.reduce((s, r) => s + r.cost, 0) / rows.length;
  const line = `| ${m.model}${m.reasoning ? ` (reasoning ${JSON.stringify(m.reasoning)})` : ''} | ${ok}/${rows.length} | ${(median(rows.map((r) => r.ms)) / 1000).toFixed(2)} s | $${cost.toFixed(5)} |`;
  console.log(line);
  lines.push(line);
  const misses = rows.filter((r) => !r.pass);
  details.push(`\n### ${m.model}: misses\n`, ...(misses.length ? misses.map((r) => `- "${r.q}" → \`${r.got}\``) : ['- none']));
  for (const r of misses) console.log(`   ✕ ${r.q}\n     ${r.got}`);
}
writeFileSync('evals/results.md', [...lines, ...details, ''].join('\n'));
console.log('wrote evals/results.md');
