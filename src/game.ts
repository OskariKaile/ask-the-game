// The one game this page is about, its video sync, and the labels every part of the page uses.

import gameJson from './data/game.json';
import syncJson from './data/clip-sync.json';
import { fmtClock } from './shared/check.ts';
import { eventsInClip } from './shared/sync.ts';
import type { ClipSync, EventType, Game, GameEvent } from './shared/types.ts';

export const game = gameJson as unknown as Game;
export const syncs = syncJson as unknown as ClipSync[];

const players = new Map(game.players.map((p) => [p.id, p]));
export const player = (id: number) => players.get(id);

export const periodLabel = (n: number) => (n === 4 ? 'OT' : `P${n}`);

/** "#94 Hakulinen" */
export function playerName(id?: number): string {
  const p = id ? players.get(id) : undefined;
  return p ? `#${p.jersey} ${p.last}` : '';
}

const WHAT: Record<EventType, string> = {
  goal: 'goal',
  save: 'shot, saved',
  miss: 'shot, missed',
  block: 'shot, blocked',
  penalty: 'penalty',
};
/** "shot, saved"; capitalised for list headings */
export const what = (e: GameEvent, capital = false) =>
  capital ? WHAT[e.type][0].toUpperCase() + WHAT[e.type].slice(1) : WHAT[e.type];

/** "P3 15:26 · Ässät goal · #34 Doucet · xG 0.11" */
export function describeEvent(e: GameEvent): string {
  const xg = e.xg !== undefined ? ` · xG ${e.xg.toFixed(2)}` : '';
  return `${periodLabel(e.period)} ${fmtClock(e.clock)} · ${game.teams[e.side].name} ${what(e)} · ${playerName(e.player)}${xg}`;
}

/** Every event that can be seen in a synced goal clip: Liiga's clip URL, and the video second (after the ad). */
export const inClip = new Map<string, { sync: ClipSync; url: string; at: number }>();
for (const sync of syncs) {
  const goal = game.events.find((e) => e.id === sync.event);
  if (!goal?.clip) continue;
  for (const { e, at } of eventsInClip(sync, game)) {
    if (!inClip.has(e.id)) inClip.set(e.id, { sync, url: goal.clip.url, at: Math.round(at * 10) / 10 });
  }
}
