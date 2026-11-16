// Turns Liiga's public game feed into one normalised event list (src/data/game.json).
//
//   node scripts/build-game.ts [gameId] [season]
//
// Raw responses are cached in data/raw/<gameId>/ so the build is reproducible offline.
// Everything the search needs (strength, score state, goalie in net, attack direction)
// is derived here once, so the browser only filters.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { Game, GameEvent, OnIcePosition, Period, Player, Side, Strength } from '../src/shared/types.ts';

const gameId = process.argv[2] ?? '2701332';
const season = process.argv[3] ?? '2027';
// Raw responses live in public/ so the site serves its own copy (see the Data source panel).
const RAW = `public/liiga/${gameId}`;
const API = 'https://liiga.fi/api/v2';

async function raw(name: string, path: string): Promise<any> {
  const file = `${RAW}/${name}.json`;
  if (!existsSync(file)) {
    mkdirSync(RAW, { recursive: true });
    const res = await fetch(`${API}/${path}`, { headers: { 'user-agent': 'Mozilla/5.0 (ask-the-game data build)' } });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    writeFileSync(file, await res.text());
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

const detail = await raw('game', `games/${season}/${gameId}`);
const shotmap: any[] = await raw('shotmap', `shotmap/${season}/${gameId}`);
const stats = await raw('stats', `games/stats/${season}/${gameId}`);
const g = detail.game;

// ---------- teams and players ----------

// Marker colours on the dark rink: HPK orange, Ässät ice white.
const COLORS: Record<string, string> = { hpk: '#fd7a33', 'ässät': '#e8eef6' };
const sideOfNumeric = new Map<number, Side>();
const teams = {} as Game['teams'];
for (const side of ['home', 'away'] as Side[]) {
  const t = g[`${side}Team`];
  const [numeric, slug] = String(t.teamId).split(':');
  sideOfNumeric.set(Number(numeric), side);
  teams[side] = {
    side,
    name: t.teamName,
    color: COLORS[slug] ?? (side === 'home' ? '#fd7a33' : '#e8eef6'),
    goals: t.goals,
    xg: t.expectedGoals,
  };
}
const other = (s: Side): Side => (s === 'home' ? 'away' : 'home');

function pos(p: any): string {
  const r = String(p.role ?? '');
  if (r.includes('GOALIE')) return 'G';
  if (r.includes('CENTER')) return 'C';
  if (r.includes('LEFT_WING')) return 'LW';
  if (r.includes('RIGHT_WING')) return 'RW';
  if (r.includes('DEFEN')) return 'D';
  return String(p.roleCode ?? '').includes('P') ? 'D' : 'F';
}

const players: Player[] = [];
for (const side of ['home', 'away'] as Side[]) {
  for (const p of detail[`${side}TeamPlayers`]) {
    players.push({
      id: p.id,
      side,
      jersey: p.jersey,
      first: p.firstName,
      last: p.lastName,
      pos: pos(p),
      dressed: p.line !== null && !p.removed,
    });
  }
}
const playerById = new Map(players.map((p) => [p.id, p]));

// ---------- periods ----------

const periods: Period[] = (g.periods as any[])
  .filter((p) => p.endTime > p.startTime)
  .map((p) => ({
    n: p.index,
    length: p.endTime - p.startTime,
    label: p.category === 'OVERTIME' ? 'OT' : ['1st', '2nd', '3rd'][p.index - 1] ?? `P${p.index}`,
  }));
const periodStart = new Map<number, number>((g.periods as any[]).map((p) => [p.index, p.startTime]));
const otIs3v3 = periods.some((p) => p.label === 'OT' && p.length === 300);

// ---------- goalie timeline ----------

// Goalie per period = the goalie with the most time on ice in that period.
const goalieByPeriod: Record<Side, Map<number, number>> = { home: new Map(), away: new Map() };
for (const side of ['home', 'away'] as Side[]) {
  for (const per of stats[`${side}Team`] as any[]) {
    const best = [...(per.goaliePeriodStats ?? [])].sort((a, b) => b.period.timeofice - a.period.timeofice)[0];
    if (best && best.period.timeofice > 0) goalieByPeriod[side].set(per.period, best.playerId);
  }
  if ((g[`${side}Team`].goalKeeperChanges ?? []).length) {
    console.warn(`! ${side} has goalie changes: the per-period goalie may be wrong for part of a period`);
  }
}
const emptyNet: Record<Side, [number, number][]> = { home: [], away: [] };
for (const side of ['home', 'away'] as Side[]) {
  for (const e of g[`${side}Team`].goalKeeperEvents ?? []) {
    if (e.emptyNet) emptyNet[side].push([e.beginTime, e.endTime]);
  }
}
const goalieIn = (side: Side, t: number, period: number): number | undefined =>
  emptyNet[side].some(([a, b]) => t >= a && t < b) ? undefined : goalieByPeriod[side].get(period);

// ---------- penalties and strength ----------

const PENALTY_EN: Record<string, string> = {
  KAM: 'Tripping',
  KOR: 'High-sticking',
  POI: 'Cross-checking',
  VKV: 'Roughing',
  KOU: 'Hooking',
  PIT: 'Holding',
  HAK: 'Slashing',
  EST: 'Interference',
  KYY: 'Elbowing',
};

interface Pen { side: Side; begin: number; end: number; minutes: number; coincidental: boolean }
const pens: Pen[] = [];
for (const side of ['home', 'away'] as Side[]) {
  for (const p of g[`${side}Team`].penaltyEvents ?? []) {
    pens.push({
      side,
      begin: p.penaltyBegintime,
      end: p.penaltyEndtime,
      minutes: p.penaltyMinutes,
      coincidental: p.penaltyInfo === 'K',
    });
  }
}
// Coincidental minors and misconducts do not change the manpower.
const activePens = (side: Side, t: number) =>
  pens.filter((p) => p.side === side && !p.coincidental && p.minutes <= 5 && t >= p.begin && t < p.end).length;

function strengthAt(side: Side, t: number, period: number) {
  const nOwn = activePens(side, t);
  const nOpp = activePens(other(side), t);
  let own: number;
  let opp: number;
  if (period === 4 && otIs3v3) {
    const d = nOpp - nOwn;
    own = Math.min(5, 3 + Math.max(0, d));
    opp = Math.min(5, 3 + Math.max(0, -d));
  } else {
    own = Math.max(3, 5 - nOwn);
    opp = Math.max(3, 5 - nOpp);
  }
  const strength: Strength = own > opp ? 'PP' : own < opp ? 'SH' : 'EV';
  const extraAttacker = goalieIn(side, t, period) === undefined;
  const empty = goalieIn(other(side), t, period) === undefined;
  if (extraAttacker) own += 1;
  if (empty) opp += 1;
  return { strength, manpower: `${own}v${opp}`, extraAttacker, emptyNet: empty };
}

// ---------- score timeline ----------

const goalTimes: { side: Side; t: number }[] = [];
for (const side of ['home', 'away'] as Side[]) {
  for (const e of g[`${side}Team`].goalEvents ?? []) goalTimes.push({ side, t: e.gameTime });
}
function scoreAt(side: Side, t: number) {
  const f = goalTimes.filter((x) => x.side === side && x.t < t).length;
  const a = goalTimes.filter((x) => x.side !== side && x.t < t).length;
  return { scoreFor: f, scoreAgainst: a, scoreState: f > a ? 'leading' : f < a ? 'trailing' : 'tied' } as const;
}

// ---------- coordinates ----------

// The feed says which team defends the left end in each period ("leftTeam" attacks right).
// We rotate every shot so the home team always attacks right and the away team left.
function place(s: any, side: Side) {
  const attacksRight = s.leftTeam === s.shootingTeamId;
  const flip = attacksRight !== (side === 'home');
  const fx = (x: number) => (flip ? 1000 - x : x);
  const fy = (y: number) => (flip ? 500 - y : y);
  const positions: OnIcePosition[] | undefined = s.playerStartPositions?.length
    ? s.playerStartPositions.map((p: any) => ({ player: p.playerId, x: fx(p.x), y: fy(p.y) }))
    : undefined;
  return { x: fx(s.shotX), y: fy(s.shotY), positions };
}

// ---------- events ----------

const events: Omit<GameEvent, 'id'>[] = [];
const SHOT_TYPE: Record<string, GameEvent['type']> = { MISSED: 'miss', GOALIE_BLOCKED: 'save', PLAYER_BLOCKED: 'block' };
const periodOf = (t: number) => {
  let n = 1;
  for (const [idx, start] of periodStart) if (t >= start && idx > n) n = idx;
  return n;
};
const ppMismatch: string[] = [];

for (const s of shotmap) {
  const side = sideOfNumeric.get(s.shootingTeamId)!;
  const st = strengthAt(side, s.gameTime, s.period);
  if ((s.type === 'PowerplayShot') !== (st.strength === 'PP')) ppMismatch.push(`${s.gameTime}s ${s.type} vs ${st.strength}`);
  if (s.eventType === 'GOAL') continue; // merged with the official goal events below
  const type = SHOT_TYPE[s.eventType];
  if (!type) {
    console.warn(`! unknown shot outcome ${s.eventType}, skipped`);
    continue;
  }
  events.push({
    type,
    period: s.period,
    t: s.gameTime,
    clock: s.gameTime - (periodStart.get(s.period) ?? 0),
    side,
    player: s.shooterId,
    blocker: type === 'block' && s.blockerId ? s.blockerId : undefined,
    goalie: goalieIn(other(side), s.gameTime, s.period),
    ...place(s, side),
    xg: s.xg,
    ...st,
    ...scoreAt(side, s.gameTime),
  });
}

const GOAL_TAGS: Record<string, string> = {
  YV: 'Power play',
  YV2: 'Power play 5v3',
  AV: 'Shorthanded',
  TM: 'Empty net',
  IM: 'Extra attacker',
  RL: 'Penalty shot',
  VL: 'Shootout',
};
const usedShots = new Set<any>();
let unmatchedGoals = 0;
for (const side of ['home', 'away'] as Side[]) {
  for (const e of g[`${side}Team`].goalEvents ?? []) {
    const numeric = [...sideOfNumeric].find(([, s]) => s === side)![0];
    const shot = shotmap.find(
      (s) => s.eventType === 'GOAL' && s.shootingTeamId === numeric && !usedShots.has(s) && Math.abs(s.gameTime - e.gameTime) <= 5,
    );
    if (shot) usedShots.add(shot);
    else unmatchedGoals++;
    // strength just before the goal: a power-play goal ends the penalty at the same second
    const tStrength = shot ? shot.gameTime : e.gameTime - 1;
    const tags = (e.goalTypes as string[]).map((c) => GOAL_TAGS[c] ?? c);
    if (e.period === 4) tags.push('Overtime');
    if (e.winningGoal) tags.push('Game winner');
    events.push({
      type: 'goal',
      period: e.period,
      t: e.gameTime,
      clock: e.gameTime - (periodStart.get(e.period) ?? 0),
      side,
      player: e.scorerPlayerId,
      assists: e.assistantPlayerIds ?? [],
      goalie: goalieIn(other(side), tStrength, e.period),
      ...(shot ? place(shot, side) : {}),
      xg: shot?.xg,
      ...strengthAt(side, tStrength, e.period),
      ...scoreAt(side, e.gameTime),
      tags,
      clip: e.videoClipUrl ? { url: e.videoClipUrl, thumb: e.videoThumbnailUrl ?? undefined } : undefined,
    });
  }
}

for (const side of ['home', 'away'] as Side[]) {
  for (const p of g[`${side}Team`].penaltyEvents ?? []) {
    events.push({
      type: 'penalty',
      period: p.period ?? periodOf(p.gameTime),
      t: p.gameTime,
      clock: p.gameTime - (periodStart.get(p.period) ?? 0),
      side,
      player: p.playerId,
      // manpower just before the call, not after it
      ...strengthAt(side, Math.max(0, p.gameTime - 1), p.period),
      ...scoreAt(side, p.gameTime),
      penalty: {
        code: p.penaltyFaultType,
        name: PENALTY_EN[p.penaltyFaultType] ?? p.penaltyFaultName,
        minutes: p.penaltyMinutes,
        coincidental: p.penaltyInfo === 'K',
      },
    });
  }
}

const order: Record<string, number> = { penalty: 0, block: 1, miss: 2, save: 3, goal: 4 };
events.sort((a, b) => a.t - b.t || order[a.type] - order[b.type]);

// ---------- sanity checks ----------

const missingPlayers = events.flatMap((e) => [e.player, e.blocker, e.goalie, ...(e.assists ?? [])]).filter((id) => id && !playerById.has(id));
if (missingPlayers.length) throw new Error(`players missing from the roster: ${[...new Set(missingPlayers)].join(', ')}`);
const goalsBySide = (s: Side) => events.filter((e) => e.type === 'goal' && e.side === s).length;
for (const s of ['home', 'away'] as Side[]) {
  if (goalsBySide(s) !== teams[s].goals) throw new Error(`${s}: ${goalsBySide(s)} goal events but the result says ${teams[s].goals}`);
}

const fin = g.finishedType as string;
const result = `${teams.home.name} ${teams.home.goals}–${teams.away.goals} ${teams.away.name}${
  fin.includes('WINNING_SHOT') ? ' (SO)' : fin.includes('EXTENDED') ? ' (OT)' : ''
}`;

const game: Game = {
  id: String(g.id),
  league: 'Liiga',
  season: `${Number(g.season) - 1}–${String(g.season).slice(2)}`,
  date: g.start,
  venue: `${g.iceRink?.name ?? ''}`.trim(),
  spectators: g.spectators,
  result,
  teams,
  periods,
  players: players.sort((a, b) => (a.side === b.side ? a.jersey - b.jersey : a.side === 'home' ? -1 : 1)),
  events: events.map((e, i) => ({ id: `e${i + 1}`, ...e })),
  source: {
    name: 'Liiga public game feed',
    urls: [`${API}/games/${season}/${gameId}`, `${API}/shotmap/${season}/${gameId}`, `${API}/games/stats/${season}/${gameId}`],
    fetched: statSync(`${RAW}/game.json`).mtime.toISOString().slice(0, 10), // when the raw feed was downloaded
    ppCheck: { agree: shotmap.length - ppMismatch.length, shots: shotmap.length },
  },
};

writeFileSync('src/data/game.json', JSON.stringify(game));
const count = (t: string) => game.events.filter((e) => e.type === t).length;
console.log(`${result}, ${game.date.slice(0, 10)}, ${game.venue}`);
console.log(
  `events ${game.events.length}: goals ${count('goal')}, saves ${count('save')}, misses ${count('miss')}, blocks ${count('block')}, penalties ${count('penalty')}`,
);
console.log(`goals without a shot location: ${unmatchedGoals}`);
console.log(`power-play label check, feed vs our penalty timeline: ${ppMismatch.length ? ppMismatch.join('; ') : `all ${shotmap.length} shots agree`}`);
