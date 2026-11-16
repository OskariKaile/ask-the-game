// Runs a checked filter over the game's events. Plain code, so the answer is exactly
// what the data says: the model never sees or counts the events.

import type { CheckedFilter, EventType, Game, GameEvent } from './types.ts';

export function involves(e: GameEvent, id: number, role: CheckedFilter['playerRole']): boolean {
  const primary = e.player === id;
  const assist = !!e.assists?.includes(id);
  const blocker = e.blocker === id;
  if (role === 'primary') return primary;
  if (role === 'assist') return assist;
  if (role === 'blocker') return blocker;
  return primary || assist || blocker;
}

export function runQuery(f: CheckedFilter, game: Game): GameEvent[] {
  return game.events.filter((e) => {
    if (f.events.length && !f.events.includes(e.type)) return false;
    if (f.side && e.side !== f.side) return false;
    if (f.players.length && !f.players.some((id) => involves(e, id, f.playerRole))) return false;
    if (f.goalie && e.goalie !== f.goalie) return false;
    if (f.periods.length && !f.periods.includes(e.period)) return false;
    if (f.from !== undefined && e.clock < f.from) return false;
    if (f.to !== undefined && e.clock > f.to) return false;
    if (f.strength.length && !f.strength.includes(e.strength)) return false;
    if (f.goaliePulled && !(e.extraAttacker || e.emptyNet)) return false;
    if (f.minXg !== undefined && (e.xg === undefined || e.xg < f.minXg)) return false;
    if (f.scoreState && e.scoreState !== f.scoreState) return false;
    return true;
  });
}

/** One plain sentence computed from the results, never from the model. */
export function summarize(events: GameEvent[], f: CheckedFilter, game: Game): string {
  if (!events.length) return 'No events match. That is an answer too: nothing like this happened in this game.';
  const n = (t: EventType) => events.filter((e) => e.type === t).length;
  const parts: string[] = [];
  const names: [EventType, string, string][] = [
    ['goal', 'goal', 'goals'],
    ['save', 'save', 'saves'],
    ['miss', 'miss', 'misses'],
    ['block', 'block', 'blocks'],
    ['penalty', 'penalty', 'penalties'],
  ];
  for (const [t, one, many] of names) if (n(t)) parts.push(`${n(t)} ${n(t) === 1 ? one : many}`);
  const xg = events.reduce((s, e) => s + (e.xg ?? 0), 0);
  const shots = events.filter((e) => e.xg !== undefined).length;
  const bySide = (['home', 'away'] as const)
    .map((s) => ({ s, c: events.filter((e) => e.side === s).length }))
    .filter((x) => x.c);
  const split = !f.side && bySide.length === 2 ? ` (${bySide.map((x) => `${game.teams[x.s].name} ${x.c}`).join(', ')})` : '';
  return `${events.length} ${events.length === 1 ? 'match' : 'matches'}${split}: ${parts.join(', ')}.${
    shots ? ` Total xG ${xg.toFixed(2)} on ${shots} shot${shots === 1 ? '' : 's'}.` : ''
  }`;
}
