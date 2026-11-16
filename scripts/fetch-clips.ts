// Downloads the goal footage of every goal clip, for the offline scoreboard OCR
// (scripts/sync-clips.ts). The copies stay on this machine: .cache/ is git-ignored and never
// deployed. The site itself plays Liiga's own stream.
//
//   node scripts/fetch-clips.ts        (after `npm run data`)
//
// Liiga serves each clip as HLS: a short pre-roll ad, a discontinuity, then the goal footage as
// byte ranges of one 720p MPEG-TS file. This saves that one file as .cache/clips/<id>.ts, so its
// seconds are the sync's "video seconds"; the player adds the ad's length back (adEnd in
// src/shared/sync.ts uses the same rule: the footage starts after the first discontinuity).
// Clips already downloaded are kept.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Game } from '../src/shared/types.ts';

const OUT = '.cache/clips';
const UA = { 'user-agent': 'Mozilla/5.0 (ask-the-game clip sync)' };

const game = JSON.parse(readFileSync('src/data/game.json', 'utf8')) as Game;
mkdirSync(OUT, { recursive: true });

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/** Media URIs listed after the playlist's first discontinuity (all of them if it has none). */
function footage(m3u8: string, base: string): string[] {
  const lines = m3u8.split('\n').map((l) => l.trim());
  const afterAd = lines.slice(lines.indexOf('#EXT-X-DISCONTINUITY') + 1);
  return [...new Set(afterAd.filter((l) => l && !l.startsWith('#')).map((u) => new URL(u, base).href))];
}

for (const e of game.events.filter((x) => x.clip)) {
  const id = e.clip!.url.split('/videos/')[1].split('/')[0];
  const file = `${OUT}/${id}.ts`;
  if (existsSync(file)) {
    console.log(`= ${id} (already downloaded)`);
    continue;
  }
  // master playlist -> highest-bandwidth variant -> the one file of goal footage
  const lines = (await (await get(e.clip!.url)).text()).split('\n');
  let best = { bw: -1, uri: '' };
  lines.forEach((l, i) => {
    const bw = Number(/BANDWIDTH=(\d+)/.exec(l)?.[1] ?? NaN);
    if (bw > best.bw) best = { bw, uri: lines[i + 1].trim() };
  });
  const variant = new URL(best.uri, e.clip!.url).href;
  const files = footage(await (await get(variant)).text(), variant);
  if (files.length !== 1) throw new Error(`${id}: expected one file of goal footage, got ${files.length}`);

  const bytes = Buffer.from(await (await get(files[0])).arrayBuffer());
  writeFileSync(file, bytes);
  console.log(`+ ${id} ${(bytes.length / 1024 / 1024).toFixed(1)} MB (P${e.period} ${e.clock}s)`);
}
