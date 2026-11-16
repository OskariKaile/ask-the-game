// Ties every goal clip to the game clock by reading the broadcast scoreboard in the video.
//
//   node scripts/sync-clips.ts            (after `npm run clips`; needs ffmpeg on PATH)
//   node scripts/sync-clips.ts --fresh    (ignore cached OCR results)
//
// 1. ffmpeg samples 4 frames per second from the downloaded goal footage (.cache/clips, see
//    scripts/fetch-clips.ts) and crops the scoreboard:
//    clock, period, score and the strip below it ("5 VS 3", "Ässät | Tyhjä maali").
// 2. Tesseract, an LSTM neural-network OCR (tesseract.js, runs locally), reads every crop.
// 3. Plain code checks the readings, the same way the filter check treats the language model:
//    a running clock must drop exactly one second per video second, so readings that don't fit
//    are thrown out; the value the clock freezes at must equal Liiga's goal time; period, score
//    and power-play strip must agree with the feed.
//
// It runs once; the result is saved to src/data/clip-sync.json and the page only reads that file.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { videoSecond } from '../src/shared/sync.ts';
import type { ClipSync, Game, GameEvent, SyncCheck } from '../src/shared/types.ts';

const FPS = 4;
const SLOW_EVERY = 4; // period, score and strip are read once a second
const CLIPS = '.cache/clips';
const CACHE = '.cache/sync';
const fresh = process.argv.includes('--fresh');

// Scoreboard boxes in the 1280x720 frame (MTV's graphics, same place in every clip).
const BOX = {
  clock: { x: 252, y: 38, w: 54, h: 19, negate: false, chars: '0123456789:.' },
  period: { x: 318, y: 39, w: 26, h: 17, negate: true, chars: '123.JA' }, // clear of the box's slanted edges
  score: { x: 258, y: 68, w: 78, h: 24, negate: true, chars: '0123456789-' },
  strip: { x: 120, y: 96, w: 360, h: 26, negate: true, chars: '' },
} as const;
type Field = keyof typeof BOX;

interface Read { s: number; text: string; conf: number }
type Ocr = Record<Field, Read[]>;

const game = JSON.parse(readFileSync('src/data/game.json', 'utf8')) as Game;
const goals = game.events.filter((e) => e.type === 'goal' && e.clip);
const clipId = (e: GameEvent) => e.clip!.url.split('/videos/')[1].split('/')[0];
const periodLength = (n: number) => game.periods.find((p) => p.n === n)?.length ?? 1200;
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const periodName = (n: number) => (n === 4 ? 'OT' : `P${n}`);

// ---------- 1 + 2: frames and OCR (cached per clip) ----------

function extract(id: string, dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fields = Object.keys(BOX) as Field[];
  const chains = fields.map((f, i) => {
    const b = BOX[f];
    // dark text on white, pure black and white, with a white margin: what Tesseract reads best
    return (
      `[v${i}]crop=${b.w}:${b.h}:${b.x}:${b.y},scale=iw*4:ih*4:flags=lanczos,format=gray${b.negate ? ',negate' : ''},` +
      `lut=c0='if(lt(val,120),0,255)',pad=iw+48:ih+48:24:24:white[${f}]`
    );
  });
  const graph = `[0:v]fps=${FPS},split=${fields.length}${fields.map((_, i) => `[v${i}]`).join('')};${chains.join(';')}`;
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', `${CLIPS}/${id}.ts`, '-filter_complex', graph,
    ...fields.flatMap((f) => ['-map', `[${f}]`, `${dir}/${f}_%04d.png`]),
  ]);
}

async function readClip(id: string, worker: Awaited<ReturnType<typeof createWorker>>): Promise<Ocr> {
  const dir = `${CACHE}/${id}`;
  const cached = `${dir}/ocr.json`;
  if (!fresh && existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));
  extract(id, dir);
  const out = {} as Ocr;
  for (const f of Object.keys(BOX) as Field[]) {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: BOX[f].chars,
    });
    const files = readdirSync(dir).filter((n) => n.startsWith(`${f}_`)).sort();
    out[f] = [];
    for (const [i, file] of files.entries()) {
      if (f !== 'clock' && i % SLOW_EVERY) continue;
      const { data } = await worker.recognize(`${dir}/${file}`);
      out[f].push({ s: i / FPS, text: data.text.trim(), conf: Math.round(data.confidence) });
    }
  }
  writeFileSync(cached, JSON.stringify(out));
  return out;
}

// ---------- 3: the checks (plain code) ----------

function parseClock(t: string): number | undefined {
  const s = t.replace(/\s/g, '');
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m && Number(m[2]) < 60 && Number(m[1]) <= 20) return Number(m[1]) * 60 + Number(m[2]);
  const tenths = /^(\d{1,2})\.(\d)$/.exec(s); // last minute: "59.3"
  if (tenths && Number(tenths[1]) < 60) return Number(tenths[1]) + Number(tenths[2]) / 10;
  return undefined;
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
function majority<T>(xs: T[]): { value?: T; share: number } {
  const counts = new Map<string, { v: T; n: number }>();
  for (const x of xs) {
    const k = JSON.stringify(x);
    counts.set(k, { v: x, n: (counts.get(k)?.n ?? 0) + 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best ? { value: best.v, share: best.n / xs.length } : { share: 0 };
}

function analyse(goal: GameEvent, ocr: Ocr): ClipSync {
  const L = periodLength(goal.period);
  const checks: SyncCheck[] = [];
  const clock = ocr.clock
    .filter((r) => r.conf >= 50)
    .map((r) => ({ s: r.s, n: parseClock(r.text) }))
    .filter((r): r is { s: number; n: number } => r.n !== undefined && r.n <= L);

  // A running clock means remaining + video time is constant. Find the busiest 1.3 s window
  // of that sum; readings outside it are a stopped clock or misreads.
  const ks = clock.map((r) => r.n + r.s).sort((a, b) => a - b);
  let best = { from: 0, count: 0 };
  for (let i = 0, j = 0; i < ks.length; i++) {
    while (ks[j] < ks[i] - 1.3) j++;
    if (i - j + 1 > best.count) best = { from: ks[j], count: i - j + 1 };
  }
  const running = clock.filter((r) => r.n + r.s >= best.from && r.n + r.s <= best.from + 1.3).sort((a, b) => a.s - b.s);
  const base = { id: clipId(goal), event: goal.id, frames: ocr.clock.length, clockReads: clock.length, used: running.length, periodLength: L };

  if (running.length < 8) {
    checks.push({ level: 'error', text: `Only ${running.length} frames showed a running clock: not enough to sync this clip.` });
    return { ...base, offset: null, goalAt: null, live: null, stop: 'not-visible', checks };
  }

  // The display shows whole seconds (rounded up while counting down), so the exact moment a
  // digit flips gives the offset to a fraction of a second.
  const flips: number[] = [];
  for (let i = 1; i < running.length; i++) {
    const a = running[i - 1];
    const b = running[i];
    if (b.s - a.s <= 1 / FPS + 0.01 && a.n - b.n === 1) flips.push(b.n + (a.s + b.s) / 2);
  }
  const offset = flips.length >= 3 ? median(flips) : median(running.map((r) => r.n + r.s)) - 0.5;
  const outliers = clock.length - running.length;
  checks.push({
    level: 'ok',
    text: `Clock read in ${clock.length} of ${ocr.clock.length} frames; ${running.length} fit a clock running 1 s per video second (${flips.length} digit flips timed).`,
  });

  // Liiga logs whole seconds elapsed; the goal is somewhere in that second.
  const goalRemaining = L - goal.clock;
  const goalAt = Math.round(videoSecond(offset, L, goal.clock) * 100) / 100;
  const live: [number, number] = [running[0].s, running[running.length - 1].s];

  // Where does the clock freeze after the run? That's the clock at the whistle.
  const after = clock.filter((r) => r.s > live[1] - 0.5 && r.n + r.s > best.from + 1.3);
  const frozen = majority(after.map((r) => r.n));
  const frozenFrames = after.filter((r) => r.n === frozen.value).length;
  let stop: ClipSync['stop'] = 'not-visible';
  if (frozen.value !== undefined && frozenFrames >= 6) {
    const diff = frozen.value - goalRemaining;
    stop = diff === 0 ? 'exact' : Math.abs(diff) <= 1 ? 'within-1s' : 'mismatch';
    checks.push(
      diff === 0
        ? { level: 'ok', text: `Clock stops at ${mmss(frozen.value)}: exactly Liiga's goal time, ${periodName(goal.period)} ${mmss(goal.clock)}.` }
        : Math.abs(diff) <= 1
          ? { level: 'ok', text: `Clock stops at ${mmss(frozen.value)}, within a second of Liiga's goal time ${periodName(goal.period)} ${mmss(goal.clock)} (the whistle comes just after the goal).` }
          : { level: 'error', text: `Clock stops at ${mmss(frozen.value)}, but Liiga has the goal at ${periodName(goal.period)} ${mmss(goal.clock)} (${mmss(goalRemaining)} left).` },
    );
  } else {
    const last = running[running.length - 1].n;
    checks.push(
      last >= goalRemaining && last - goalRemaining <= 2
        ? { level: 'note', text: `The scoreboard leaves the screen at ${mmss(last)}, right before Liiga's goal time (${mmss(goalRemaining)} left), so the stop itself isn't visible.` }
        : { level: 'error', text: `The running clock never comes near Liiga's goal time (${mmss(goalRemaining)} left); last read ${mmss(last)}.` },
    );
  }

  // Period, score and strip only count in frames where a clock was read too, i.e. the scoreboard
  // is really on screen (replays and close-ups otherwise produce confident-looking junk).
  const onScreen = new Set(clock.map((r) => r.s));
  const shown = (f: 'period' | 'score' | 'strip') => ocr[f].filter((r) => onScreen.has(r.s));

  // Period label
  const want = goal.period === 4 ? 'JA' : `${goal.period}.`;
  const per = majority(shown('period').filter((r) => /^(?:[123]\.?|JA)$/.test(r.text)).map((r) => (r.text === 'JA' ? 'JA' : `${r.text[0]}.`)));
  if (per.value === undefined) checks.push({ level: 'note', text: 'Period label not readable.' });
  else checks.push(per.value === want
    ? { level: 'ok', text: `Period on screen "${per.value}" = ${periodName(goal.period)}.` }
    : { level: 'error', text: `Period on screen "${per.value}", but Liiga says ${periodName(goal.period)}.` });

  // Score before the goal (home on the left)
  const home = goal.side === 'home' ? goal.scoreFor : goal.scoreAgainst;
  const away = goal.side === 'home' ? goal.scoreAgainst : goal.scoreFor;
  const scores = (from: number, to: number) =>
    shown('score')
      .filter((r) => r.s >= from && r.s < to && /^\d{1,2}-\d{1,2}$/.test(r.text.replace(/\s/g, '')))
      .map((r) => r.text.replace(/\s/g, ''));
  const before = majority(scores(0, goalAt - 0.5));
  if (before.value === undefined) checks.push({ level: 'note', text: 'Score not readable before the goal.' });
  else checks.push(before.value === `${home}-${away}`
    ? { level: 'ok', text: `Score on screen before the goal ${before.value.replace('-', '–')} = Liiga's.` }
    : { level: 'error', text: `Score on screen ${before.value.replace('-', '–')}, but Liiga has ${home}–${away} before the goal.` });
  const newScore = goal.side === 'home' ? `${home + 1}-${away}` : `${home}-${away + 1}`;
  if (scores(goalAt + 1, 999).includes(newScore)) checks.push({ level: 'ok', text: `Score on screen changes to ${newScore.replace('-', '–')} after the goal.` });

  // Power-play / empty-net strip under the scoreboard
  const strip = shown('strip').filter((r) => r.s < goalAt + 0.5).map((r) => r.text.toUpperCase().replace(/\s+/g, ' '));
  const vs = majority(strip.map((t) => /(\d)\s*V\s*S\s*(\d)/.exec(t)).filter((m) => m).map((m) => [Number(m![1]), Number(m![2])].sort().join('v')));
  const emptyNet = strip.some((t) => /TYHJ/.test(t));
  const fed = goal.manpower.split('v').map(Number).sort().join('v');
  if (vs.value) checks.push(vs.value === fed
    ? { level: 'ok', text: `Strip on screen "${vs.value.split('v').reverse().join(' VS ')}" matches my ${goal.strength} ${goal.manpower} label.` }
    : { level: 'error', text: `Strip on screen "${vs.value.split('v').reverse().join(' VS ')}", but my label says ${goal.strength} ${goal.manpower}.` });
  if (emptyNet) checks.push(goal.extraAttacker || goal.emptyNet
    ? { level: 'ok', text: 'Strip on screen "Tyhjä maali" (empty net) matches my goalie-pulled label.' }
    : { level: 'error', text: 'Strip on screen says "Tyhjä maali" (empty net), but my data has both goalies in.' });
  if (!vs.value && !emptyNet && goal.strength !== 'EV')
    checks.push({ level: 'note', text: `No power-play strip visible; my label says ${goal.strength} ${goal.manpower}.` });

  if (outliers > clock.length * 0.4)
    checks.push({ level: 'note', text: `${outliers} clock readings didn't fit the running clock (stopped clock or misreads) and were ignored.` });

  return { ...base, offset: Math.round(offset * 100) / 100, goalAt, live, stop, checks };
}

// ---------- run ----------

mkdirSync(CACHE, { recursive: true });
const worker = await createWorker('eng', OEM.LSTM_ONLY, { cachePath: '.cache/tesseract' });
await worker.setParameters({ debug_file: '/dev/null' } as Record<string, string>); // Tesseract's layout stats on empty crops
const result: ClipSync[] = [];
for (const goal of goals) {
  const id = clipId(goal);
  if (!existsSync(`${CLIPS}/${id}.ts`)) {
    console.warn(`! ${id}: no local clip (run npm run clips)`);
    continue;
  }
  const started = Date.now();
  const sync = analyse(goal, await readClip(id, worker));
  result.push(sync);
  const bad = sync.checks.filter((c) => c.level === 'error').length;
  console.log(
    `${periodName(goal.period)} ${mmss(goal.clock)} ${id.slice(0, 8)}  goal at video ${sync.goalAt ?? '?'} s  ` +
      `${sync.used}/${sync.frames} frames  ${bad ? `${bad} FAILED` : 'ok'}  (${((Date.now() - started) / 1000).toFixed(0)} s)`,
  );
  for (const c of sync.checks) console.log(`   ${{ ok: '✓', note: 'i', error: '✕' }[c.level]} ${c.text}`);
}
await worker.terminate();
writeFileSync('src/data/clip-sync.json', JSON.stringify(result, null, 1));
console.log(`wrote src/data/clip-sync.json (${result.length} clips)`);
