// Copies every goal clip of the game onto the site, so playback never depends on Liiga's
// video service being up.
//
//   node scripts/fetch-clips.ts        (after `npm run data`; needs ffmpeg on PATH)
//
// Liiga serves each clip as HLS: a short pre-roll ad, then the goal footage as byte ranges of one
// 720p MPEG-TS file. This downloads that file (no ad) and cuts it, without re-encoding, into our own
// HLS: public/clips/<id>/index.m3u8 + 6-second .ts pieces + poster.jpg. HLS rather than one MP4
// because Cloudflare's static assets ignore Range requests, which MP4 seeking (and iPhones) need.
// Clips already copied are kept.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { Game } from '../src/shared/types.ts';

const OUT = 'public/clips';
const UA = { 'user-agent': 'Mozilla/5.0 (ask-the-game clip copy)' };
const MAX_BYTES = 25 * 1024 * 1024; // Cloudflare static assets: 25 MiB per file

const game = JSON.parse(readFileSync('src/data/game.json', 'utf8')) as Game;
mkdirSync(OUT, { recursive: true });

async function text(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}
async function save(url: string, file: string) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
const uris = (m3u8: string) => m3u8.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

for (const e of game.events.filter((x) => x.clip)) {
  const id = e.clip!.url.split('/videos/')[1].split('/')[0];
  const dir = `${OUT}/${id}`;
  const playlist = `${dir}/index.m3u8`;
  if (existsSync(playlist)) {
    console.log(`= ${id} (already copied)`);
    continue;
  }
  // master playlist -> highest-bandwidth variant -> its segments, minus the ad
  const master = await text(e.clip!.url);
  const lines = master.split('\n');
  let best = { bw: -1, uri: '' };
  lines.forEach((l, i) => {
    const bw = Number(/BANDWIDTH=(\d+)/.exec(l)?.[1] ?? NaN);
    if (bw > best.bw) best = { bw, uri: lines[i + 1].trim() };
  });
  const variant = new URL(best.uri, e.clip!.url).href;
  const files = [...new Set(uris(await text(variant)).map((u) => new URL(u, variant).href).filter((u) => !u.includes('/media/ads/')))];
  if (files.length !== 1) throw new Error(`${id}: expected one goal file, got ${files.length}`);

  mkdirSync(dir, { recursive: true });
  const ts = `${OUT}/${id}.download.ts`;
  await save(files[0], ts);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', ts, '-c', 'copy',
    '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod', '-hls_segment_filename', `${dir}/%02d.ts`, playlist,
  ]);
  rmSync(ts);
  if (e.clip!.thumb) await save(e.clip!.thumb, `${dir}/poster.jpg`);

  const pieces = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  const bytes = pieces.reduce((s, f) => s + statSync(`${dir}/${f}`).size, 0);
  const biggest = Math.max(...pieces.map((f) => statSync(`${dir}/${f}`).size));
  if (biggest > MAX_BYTES) throw new Error(`${id}: a piece is over the 25 MiB asset limit`);
  console.log(`+ ${id} ${(bytes / 1024 / 1024).toFixed(1)} MB in ${pieces.length} pieces (P${e.period} ${e.clock}s)`);
}
