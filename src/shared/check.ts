// The fact-check step. The model only drafts a filter; this code decides what is real.
// Every value is resolved against this game's actual data. Anything that does not exist
// (a player who didn't play, an event type the feed doesn't have, a sixth period) is
// rejected with a reason and, where possible, a one-click "did you mean" fix.
// Nothing here calls the model, so it is deterministic and unit-tested.

import { closest, norm } from './fuzzy.ts';
import type {
  Check,
  CheckedFilter,
  CheckResult,
  DraftFilter,
  EventType,
  Game,
  Player,
  PlayerRole,
  ScoreState,
  Side,
  Strength,
} from './types.ts';

const KEYS: (keyof DraftFilter)[] = [
  'events', 'team', 'players', 'playerRole', 'goalie', 'periods', 'from', 'to',
  'strength', 'goaliePulled', 'minXg', 'scoreState', 'unsupported',
];

const ALL_SHOTS: EventType[] = ['goal', 'save', 'miss', 'block'];

const EVENT_WORDS: Record<string, EventType[]> = {
  goal: ['goal'], goals: ['goal'], maali: ['goal'], maalit: ['goal'], tor: ['goal'], tore: ['goal'],
  save: ['save'], saves: ['save'], saved: ['save'], 'saved shot': ['save'], 'saved shots': ['save'], torjunta: ['save'], torjunnat: ['save'],
  miss: ['miss'], misses: ['miss'], missed: ['miss'], 'missed shot': ['miss'], 'missed shots': ['miss'], 'shot wide': ['miss'], ohi: ['miss'],
  block: ['block'], blocks: ['block'], blocked: ['block'], 'blocked shot': ['block'], 'blocked shots': ['block'], blokki: ['block'],
  penalty: ['penalty'], penalties: ['penalty'], jaahy: ['penalty'], jaahyt: ['penalty'], strafe: ['penalty'], strafen: ['penalty'],
  shots: ['goal', 'save'], shot: ['goal', 'save'], 'shots on goal': ['goal', 'save'], sog: ['goal', 'save'], laukaus: ['goal', 'save'], laukaukset: ['goal', 'save'], schuss: ['goal', 'save'], schusse: ['goal', 'save'],
  attempts: ALL_SHOTS, 'shot attempts': ALL_SHOTS, corsi: ALL_SHOTS, 'all shots': ALL_SHOTS,
  fenwick: ['goal', 'save', 'miss'], 'unblocked attempts': ['goal', 'save', 'miss'],
};
const CANONICAL_EVENTS = ['goal', 'save', 'miss', 'block', 'penalty', 'shots', 'attempts'];

/** Things coaches ask for that the public feed simply doesn't contain. */
const NOT_IN_FEED: [RegExp, string][] = [
  [/\bhits?\b|taklau|body ?check|checks\b/, 'The public Liiga feed has no hit events.'],
  [/face ?offs?|aloitu|bull(y|ies)|draws?\b/, 'The public feed only has faceoff totals per period, not single faceoffs.'],
  [/takeaway|giveaway|turnover|puck (loss|recover)|kiekon ?menety|riisto/, 'The public feed has no giveaways or takeaways.'],
  [/pass(es)?\b|syot/, 'The public feed has no passes.'],
  [/rush|\d ?(on|v|vs|-) ?\d ?(rush)?|odd.?man|breakaway|lapiajo|konter/, 'The public feed has no rush or odd-man tagging. That needs tracking data.'],
  [/entr(y|ies)|zone exit/, 'The public feed has no zone entries or exits.'],
  [/icing|offside|pitkat|paitsio/, 'The public feed has no icings or offsides.'],
  [/fight|tappelu/, 'The public feed has no fights.'],
  [/rebound|paluukiekko/, 'The public feed does not tag rebounds.'],
  [/shot types?|wrist|slap|snap|backhand|tip/, 'The public feed has no shot types.'],
];

const STRENGTH_WORDS: Record<string, Strength> = {
  ev: 'EV', even: 'EV', 'even strength': 'EV', '5v5': 'EV', '5 on 5': 'EV', '4v4': 'EV', '3v3': 'EV', tasaviisikoin: 'EV', tasakentin: 'EV',
  pp: 'PP', 'power play': 'PP', powerplay: 'PP', ylivoima: 'PP', uberzahl: 'PP', '5v4': 'PP', '5v3': 'PP', '4v3': 'PP',
  sh: 'SH', shorthanded: 'SH', 'short handed': 'SH', pk: 'SH', 'penalty kill': 'SH', alivoima: 'SH', unterzahl: 'SH', '4v5': 'SH', '3v5': 'SH',
};
const PULLED_WORDS = ['6v5', '6 on 5', 'en', 'empty net', 'extra attacker', 'goalie pulled', 'tyhja maali'];

const ROLE_WORDS: Record<string, PlayerRole> = {
  primary: 'primary', shooter: 'primary', scorer: 'primary', penalized: 'primary', penalised: 'primary', 'took the penalty': 'primary',
  assist: 'assist', assists: 'assist', assisted: 'assist', passer: 'assist',
  blocker: 'blocker', blocked: 'blocker', blocks: 'blocker',
  any: 'any', involved: 'any', all: 'any', points: 'any',
};

const SCORE_WORDS: Record<string, ScoreState> = {
  leading: 'leading', ahead: 'leading', up: 'leading', winning: 'leading', johdossa: 'leading', fuhrung: 'leading',
  tied: 'tied', tie: 'tied', level: 'tied', even: 'tied', tasan: 'tied', tasatilanne: 'tied', unentschieden: 'tied',
  trailing: 'trailing', behind: 'trailing', down: 'trailing', losing: 'trailing', tappiolla: 'trailing', ruckstand: 'trailing',
};

// ---------- helpers ----------

export function parseModelOutput(raw: string): { draft?: Record<string, unknown>; error?: string } {
  const text = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return { error: 'The model did not return a JSON object.' };
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'The model returned JSON, but not an object.' };
    return { draft: v as Record<string, unknown> };
  } catch {
    return { error: 'The model returned broken JSON.' };
  }
}

const asList = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
export const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function playerLabel(p: Player, game: Game): string {
  return `${p.first} ${p.last} (${game.teams[p.side].name} #${p.jersey}, ${p.pos})`;
}

function teamAliases(game: Game, side: Side): string[] {
  const name = game.teams[side].name;
  const extra: Record<string, string[]> = { HPK: ['hameenlinna', 'hameenlinnan pallokerho'], 'Ässät': ['assat', 'pori', 'porin assat'] };
  return [name, side, ...(extra[name] ?? [])];
}

function resolveTeam(input: string, game: Game): { side?: Side; fixed?: boolean } {
  const n = norm(input);
  for (const side of ['home', 'away'] as Side[]) {
    if (teamAliases(game, side).some((a) => norm(a) === n)) return { side };
  }
  const best = closest(input, ['home', 'away'] as Side[], (s) => teamAliases(game, s), 0.34);
  if (best.length === 1 || (best.length > 1 && best[0].d < best[1].d)) return { side: best[0].item, fixed: true };
  return {};
}

function parseClock(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 60);
  if (typeof v !== 'string') return undefined;
  const m = v.trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return undefined;
  const sec = Number(m[2] ?? 0);
  if (sec > 59) return undefined;
  return Number(m[1]) * 60 + sec;
}

type PlayerHit =
  | { kind: 'ok'; player: Player; fixedFrom?: string }
  | { kind: 'ambiguous'; options: Player[] }
  | { kind: 'not-dressed'; player: Player }
  | { kind: 'none'; near: Player[] };

/** Resolve "Hakulinen", "Anrei Hakulinen", "#94", "#25 HPK" or "Pinard (Ässät)" to one dressed player. */
export function findPlayer(input: string, game: Game, side?: Side, pool?: (p: Player) => boolean): PlayerHit {
  let text = norm(input);
  // an optional team written inside the player string wins over the filter's team
  for (const s of ['home', 'away'] as Side[]) {
    for (const alias of teamAliases(game, s)) {
      const a = norm(alias);
      if (a.length > 2 && new RegExp(`(^|\\s)${a}(\\s|$)`).test(text) && text !== a) {
        side = s;
        text = text.replace(new RegExp(`(^|\\s)${a}(\\s|$)`), ' ').trim();
      }
    }
  }
  const dressed = game.players.filter((p) => p.dressed && (!pool || pool(p)));
  const inSide = (ps: Player[]) => (side ? ps.filter((p) => p.side === side) : ps);

  const num = text.match(/^(?:#|no |nr |number |numero )?\s*(\d{1,2})$/);
  if (num) {
    const hits = inSide(dressed.filter((p) => p.jersey === Number(num[1])));
    if (hits.length === 1) return { kind: 'ok', player: hits[0] };
    if (hits.length > 1) return { kind: 'ambiguous', options: hits };
    return { kind: 'none', near: [] };
  }

  const keys = (p: Player) => [p.last, `${p.first} ${p.last}`, `${p.last} ${p.first}`];
  const exact = inSide(dressed.filter((p) => keys(p).some((k) => norm(k) === text)));
  if (exact.length === 1) return { kind: 'ok', player: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', options: exact };

  const benched = game.players.find((p) => !p.dressed && keys(p).some((k) => norm(k) === text) && (!side || p.side === side));
  if (benched) return { kind: 'not-dressed', player: benched };

  const near = closest(text, inSide(dressed), keys, 0.45);
  // a single close match is a typo: fix it, but say so
  if (near.length && near[0].d <= 0.25 && (near.length === 1 || near[1].d - near[0].d >= 0.1)) {
    return { kind: 'ok', player: near[0].item, fixedFrom: input };
  }
  return { kind: 'none', near: near.slice(0, 3).map((n) => n.item) };
}

const token = (p: Player, game: Game) => `#${p.jersey} ${game.teams[p.side].name}`;

// ---------- the check ----------

export function checkDraft(input: unknown, game: Game): CheckResult {
  const checks: Check[] = [];
  const filter: CheckedFilter = { events: [], players: [], playerRole: 'primary', periods: [], strength: [] };
  const fail = (draft: DraftFilter): CheckResult => ({ ok: false, filter, checks, draft });

  let obj: Record<string, unknown>;
  if (typeof input === 'string') {
    const parsed = parseModelOutput(input);
    if (!parsed.draft) {
      checks.push({ field: 'json', level: 'error', message: parsed.error! });
      return fail({});
    }
    obj = parsed.draft;
  } else if (input && typeof input === 'object' && !Array.isArray(input)) {
    obj = input as Record<string, unknown>;
  } else {
    checks.push({ field: 'json', level: 'error', message: 'The filter must be a JSON object.' });
    return fail({});
  }

  // Keep only known keys. An invented key means the model tried to filter on something
  // this data doesn't have, so it blocks the search instead of being dropped quietly.
  const draft: DraftFilter = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0) || v === '') continue;
    if ((KEYS as string[]).includes(k)) (draft as Record<string, unknown>)[k] = v;
    else {
      checks.push({
        field: 'json',
        level: 'error',
        input: `${k}: ${str(v)}`,
        message: `The model tried to filter on "${k}", which this game's data doesn't have.`,
        suggestions: [{ label: `Search without "${k}"`, patch: {} }],
      });
    }
  }

  // ----- unsupported parts of the question, flagged by the model itself -----
  const unsupported = asList(draft.unsupported).map(String);
  for (const u of unsupported) {
    const reason = NOT_IN_FEED.find(([re]) => re.test(norm(u)))?.[1] ?? 'That is not in this game\'s data.';
    const rest = unsupported.filter((x) => x !== u);
    checks.push({
      field: 'unsupported',
      level: 'error',
      input: u,
      message: `Can't search for "${u}". ${reason}`,
      suggestions: [{ label: `Search without "${u}"`, patch: { unsupported: rest.length ? rest : undefined } }],
    });
  }

  // ----- events -----
  const events = new Set<EventType>();
  const rawEvents = asList(draft.events).map(String);
  for (const e of rawEvents) {
    const n = norm(e).replace(/_/g, ' ');
    const rest = rawEvents.filter((x) => x !== e);
    const types = EVENT_WORDS[n] ?? EVENT_WORDS[n.replace(/s$/, '')];
    if (types) {
      types.forEach((t) => events.add(t));
      checks.push({ field: 'events', level: 'ok', input: e, message: eventLabel(types) });
      continue;
    }
    const reason = NOT_IN_FEED.find(([re]) => re.test(n))?.[1];
    if (reason) {
      checks.push({
        field: 'events',
        level: 'error',
        input: e,
        message: `No "${e}" in this game's data. ${reason}`,
        suggestions: [{ label: `Search without "${e}"`, patch: { events: rest.length ? rest : undefined } }],
      });
      continue;
    }
    const near = closest(n, CANONICAL_EVENTS, (w) => [w], 0.5).slice(0, 2);
    checks.push({
      field: 'events',
      level: 'error',
      input: e,
      message: `"${e}" is not an event type here. This game has goals, saves, misses, blocks and penalties.`,
      suggestions: [
        ...near.map((x) => ({ label: `Did you mean "${x.item}"?`, patch: { events: [...rest, x.item] } })),
        { label: `Search without "${e}"`, patch: { events: rest.length ? rest : undefined } },
      ],
    });
  }

  // ----- team -----
  if (draft.team !== undefined) {
    const t = resolveTeam(str(draft.team), game);
    if (t.side) {
      filter.side = t.side;
      checks.push({
        field: 'team',
        level: t.fixed ? 'fixed' : 'ok',
        input: str(draft.team),
        message: t.fixed ? `Read "${draft.team}" as ${game.teams[t.side].name}.` : game.teams[t.side].name,
      });
    } else {
      checks.push({
        field: 'team',
        level: 'error',
        input: str(draft.team),
        message: `${str(draft.team)} didn't play in this game. It was ${game.teams.home.name} vs ${game.teams.away.name}.`,
        suggestions: (['home', 'away'] as Side[]).map((s) => ({ label: game.teams[s].name, patch: { team: game.teams[s].name } })),
      });
    }
  }

  // ----- player role (read first: it decides which team a named player should be on) -----
  const rawPlayers = asList(draft.players).map(String);
  if (draft.playerRole !== undefined) {
    const role = ROLE_WORDS[norm(str(draft.playerRole))];
    if (!role) {
      checks.push({
        field: 'playerRole',
        level: 'error',
        input: str(draft.playerRole),
        message: `Unknown player role "${draft.playerRole}".`,
        suggestions: (['primary', 'assist', 'blocker', 'any'] as PlayerRole[]).map((r) => ({ label: r, patch: { playerRole: r } })),
      });
    } else if (!rawPlayers.length) {
      checks.push({ field: 'playerRole', level: 'note', input: str(draft.playerRole), message: 'Player role ignored: no player was named.' });
    } else {
      filter.playerRole = role;
      checks.push({ field: 'playerRole', level: 'ok', input: str(draft.playerRole), message: roleLabel(role) });
    }
  }

  // ----- players -----
  const opp = (s: Side): Side => (s === 'home' ? 'away' : 'home');
  // The team only helps to tell two players apart (two #8s). A player on the "wrong" team is
  // still found here, so the contradiction check below can explain it instead of "not found".
  const hint = !filter.side || filter.playerRole === 'any' ? undefined : filter.playerRole === 'blocker' ? opp(filter.side) : filter.side;
  for (const p of rawPlayers) {
    const rest = rawPlayers.filter((x) => x !== p);
    let hit = findPlayer(p, game, hint);
    if (hit.kind === 'none' && hint) {
      const anywhere = findPlayer(p, game);
      if (anywhere.kind !== 'none') hit = anywhere;
    }
    const without = { label: `Search without "${p}"`, patch: { players: rest.length ? rest : undefined } };
    if (hit.kind === 'ok') {
      filter.players.push(hit.player.id);
      checks.push({
        field: 'players',
        level: hit.fixedFrom ? 'fixed' : 'ok',
        input: p,
        message: hit.fixedFrom ? `No exact match for "${p}". Using ${playerLabel(hit.player, game)}.` : playerLabel(hit.player, game),
      });
    } else if (hit.kind === 'ambiguous') {
      checks.push({
        field: 'players',
        level: 'error',
        input: p,
        message: `"${p}" matches ${hit.options.length} players. Which one?`,
        suggestions: hit.options.map((o) => ({ label: playerLabel(o, game), patch: { players: [...rest, token(o, game)] } })),
      });
    } else if (hit.kind === 'not-dressed') {
      checks.push({
        field: 'players',
        level: 'error',
        input: p,
        message: `${hit.player.first} ${hit.player.last} is on ${game.teams[hit.player.side].name}'s roster but didn't play in this game.`,
        suggestions: [without],
      });
    } else {
      checks.push({
        field: 'players',
        level: 'error',
        input: p,
        message: /\d/.test(p)
          ? `Nobody wore ${p.trim().startsWith('#') ? p.trim() : '#' + p.trim()} ${filter.side ? `for ${game.teams[filter.side].name} ` : ''}in this game.`
          : `No player called "${p}" played in this game.`,
        suggestions: [...hit.near.map((o) => ({ label: `Did you mean ${playerLabel(o, game)}?`, patch: { players: [...rest, token(o, game)] } })), without],
      });
    }
  }

  // A player on the wrong team for the role is a contradiction, not an empty result.
  if (filter.side && filter.players.length && filter.playerRole !== 'any') {
    for (const id of filter.players) {
      const pl = game.players.find((x) => x.id === id)!;
      // the team filter means the acting team: the shooter's team, so a blocker is on the other side
      const rightSide = filter.playerRole === 'blocker' ? opp(pl.side) : pl.side;
      if (rightSide !== filter.side) {
        const own = game.teams[pl.side].name;
        checks.push({
          field: 'team',
          level: 'error',
          input: str(draft.team),
          message:
            filter.playerRole === 'blocker'
              ? `${pl.last} plays for ${own}, and a ${own} player can't block ${own}'s own shots.`
              : `${pl.last} plays for ${own}, but the team is set to ${game.teams[filter.side].name}.`,
          suggestions: [
            { label: `Use ${game.teams[rightSide].name}`, patch: { team: game.teams[rightSide].name } },
            { label: 'Drop the team', patch: { team: undefined } },
          ],
        });
      }
    }
  }

  // ----- goalie -----
  if (draft.goalie !== undefined) {
    const g = str(draft.goalie);
    const hit = findPlayer(g, game, undefined, (p) => p.pos === 'G');
    const anyone = hit.kind === 'ok' ? undefined : findPlayer(g, game);
    if (hit.kind === 'ok') {
      filter.goalie = hit.player.id;
      checks.push({ field: 'goalie', level: hit.fixedFrom ? 'fixed' : 'ok', input: g, message: `Shots on ${playerLabel(hit.player, game)}` });
      if (filter.side && filter.side === hit.player.side) {
        const opp = hit.player.side === 'home' ? 'away' : 'home';
        checks.push({
          field: 'team',
          level: 'error',
          input: str(draft.team),
          message: `${game.teams[filter.side].name} can't shoot at its own goalie ${hit.player.last}.`,
          suggestions: [
            { label: `${game.teams[opp].name} shots on ${hit.player.last}`, patch: { team: game.teams[opp].name } },
            { label: 'Drop the team', patch: { team: undefined } },
          ],
        });
      }
    } else if (anyone?.kind === 'ok') {
      checks.push({
        field: 'goalie',
        level: 'error',
        input: g,
        message: `${anyone.player.first} ${anyone.player.last} is a ${anyone.player.pos === 'D' ? 'defenceman' : 'forward'}, not a goalie.`,
        suggestions: [
          { label: `Use ${anyone.player.last} as the shooter`, patch: { goalie: undefined, players: [...rawPlayers, g] } },
          ...game.players.filter((p) => p.pos === 'G' && p.dressed && p.side !== anyone.player.side).map((p) => ({ label: `Shots on ${p.last}`, patch: { goalie: token(p, game) } })),
        ],
      });
    } else {
      checks.push({
        field: 'goalie',
        level: 'error',
        input: g,
        message: `No goalie called "${g}" played in this game.`,
        suggestions: game.players.filter((p) => p.pos === 'G' && p.dressed).map((p) => ({ label: `Did you mean ${playerLabel(p, game)}?`, patch: { goalie: token(p, game) } })),
      });
    }
  }

  // ----- periods -----
  const maxPeriod = Math.max(...game.periods.map((p) => p.n));
  for (const v of asList(draft.periods)) {
    const n0 = norm(str(v).replace(/"/g, ''));
    const words: Record<string, number> = {
      first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, ot: 4, overtime: 4, jatkoaika: 4, verlangerung: 4, 'extra time': 4,
      ensimmainen: 1, toinen: 2, kolmas: 3,
    };
    const n = typeof v === 'number' ? v : /^\d+$/.test(n0) ? Number(n0) : words[n0];
    const period = game.periods.find((p) => p.n === n);
    if (period) {
      if (!filter.periods.includes(n!)) filter.periods.push(n!);
      checks.push({ field: 'periods', level: 'ok', input: str(v), message: period.label === 'OT' ? 'Overtime' : `${period.label} period` });
    } else {
      const shootout = n === 5 || /shoot ?out|voittolauka|penaltyschiessen/.test(n0);
      checks.push({
        field: 'periods',
        level: 'error',
        input: str(v),
        message: shootout
          ? maxPeriod >= 4
            ? 'There was no shootout: the game was decided in overtime.'
            : 'There was no shootout in this game.'
          : `This game had periods 1–3${maxPeriod >= 4 ? ' and overtime' : ''}.`,
        suggestions: [{ label: 'Search all periods', patch: { periods: undefined } }],
      });
    }
  }
  filter.periods.sort();

  // ----- time window -----
  const lengths = (filter.periods.length ? filter.periods : game.periods.map((p) => p.n)).map((n) => game.periods.find((p) => p.n === n)!.length);
  const maxLen = Math.max(...lengths);
  const from = draft.from !== undefined ? parseClock(draft.from) : undefined;
  const to = draft.to !== undefined ? parseClock(draft.to) : undefined;
  if (draft.from !== undefined && from === undefined) {
    checks.push({ field: 'from', level: 'error', input: str(draft.from), message: `Can't read "${str(draft.from)}" as a period clock (mm:ss).`, suggestions: [{ label: 'Drop the start time', patch: { from: undefined } }] });
  }
  if (draft.to !== undefined && to === undefined) {
    checks.push({ field: 'to', level: 'error', input: str(draft.to), message: `Can't read "${str(draft.to)}" as a period clock (mm:ss).`, suggestions: [{ label: 'Drop the end time', patch: { to: undefined } }] });
  }
  if (from !== undefined && to !== undefined && from >= to) {
    checks.push({
      field: 'from',
      level: 'error',
      input: `${str(draft.from)}–${str(draft.to)}`,
      message: 'The time window ends before it starts.',
      suggestions: [{ label: `Use ${fmtClock(to)}–${fmtClock(from)}`, patch: { from: draft.to, to: draft.from } }],
    });
  } else {
    for (const [field, v, raw] of [['from', from, draft.from], ['to', to, draft.to]] as const) {
      if (v === undefined) continue;
      if (v > maxLen) {
        checks.push({
          field,
          level: 'error',
          input: str(raw),
          message: `${fmtClock(v)} is past the end of the period (${fmtClock(maxLen)}).`,
          suggestions: [{ label: field === 'to' ? `End at ${fmtClock(maxLen)}` : 'Drop the start time', patch: { [field]: field === 'to' ? fmtClock(maxLen) : undefined } }],
        });
      } else {
        filter[field] = v;
      }
    }
    if (filter.from !== undefined || filter.to !== undefined) {
      checks.push({
        field: 'from',
        level: 'ok',
        input: `${draft.from ?? ''}–${draft.to ?? ''}`,
        message: `Period clock ${fmtClock(filter.from ?? 0)}–${fmtClock(filter.to ?? maxLen)}`,
      });
    }
  }

  // ----- strength -----
  for (const v of asList(draft.strength).map(String)) {
    const n = norm(v).replace(/-/g, ' ').replace(/(\d) ?(on|vs) ?(\d)/, '$1v$3');
    const s = STRENGTH_WORDS[n];
    if (s) {
      if (!filter.strength.includes(s)) filter.strength.push(s);
      checks.push({ field: 'strength', level: 'ok', input: v, message: strengthLabel(s) });
    } else if (PULLED_WORDS.includes(n)) {
      filter.goaliePulled = true;
      checks.push({ field: 'strength', level: 'fixed', input: v, message: 'Read as "goalie pulled" (6-on-5 or empty net).' });
    } else {
      checks.push({
        field: 'strength',
        level: 'error',
        input: v,
        message: `Unknown strength "${v}".`,
        suggestions: (['EV', 'PP', 'SH'] as Strength[]).map((x) => ({ label: strengthLabel(x), patch: { strength: [x] } })),
      });
    }
  }

  // ----- goalie pulled -----
  if (draft.goaliePulled !== undefined) {
    const v = draft.goaliePulled === true || /^(true|yes|1)$/i.test(str(draft.goaliePulled));
    if (v) {
      filter.goaliePulled = true;
      checks.push({ field: 'goaliePulled', level: 'ok', input: str(draft.goaliePulled), message: 'Goalie pulled (6-on-5 or empty net)' });
    }
  }

  // ----- xG -----
  if (draft.minXg !== undefined) {
    let x = Number(draft.minXg);
    if (!Number.isFinite(x) || x < 0 || x > 100) {
      checks.push({ field: 'minXg', level: 'error', input: str(draft.minXg), message: 'xG must be a number between 0 and 1.', suggestions: [{ label: 'Drop the xG filter', patch: { minXg: undefined } }] });
    } else {
      let level: Check['level'] = 'ok';
      let message = `xG ≥ ${x.toFixed(2)}`;
      if (x > 1) {
        x = x / 100;
        level = 'fixed';
        message = `Read ${draft.minXg} as a percentage: xG ≥ ${x.toFixed(2)}.`;
      }
      filter.minXg = x;
      checks.push({ field: 'minXg', level, input: str(draft.minXg), message });
    }
  }

  // ----- score state -----
  if (draft.scoreState !== undefined) {
    const s = SCORE_WORDS[norm(str(draft.scoreState))];
    if (s) {
      filter.scoreState = s;
      checks.push({ field: 'scoreState', level: 'ok', input: str(draft.scoreState), message: `While ${filter.side ? game.teams[filter.side].name + ' was' : 'the team was'} ${s}` });
    } else {
      checks.push({
        field: 'scoreState',
        level: 'error',
        input: str(draft.scoreState),
        message: `Unknown score state "${draft.scoreState}".`,
        suggestions: (['leading', 'tied', 'trailing'] as ScoreState[]).map((x) => ({ label: x, patch: { scoreState: x } })),
      });
    }
  }

  // ----- defaults that change what is searched: always said out loud -----
  if (filter.goalie && !events.size) {
    ALL_SHOTS.slice(0, 2).forEach((t) => events.add(t));
    checks.push({ field: 'events', level: 'note', message: 'No event type given: showing shots on goal (goals + saves).' });
  }
  if (filter.minXg !== undefined && (!events.size || events.has('penalty'))) {
    if (!events.size) ALL_SHOTS.forEach((t) => events.add(t));
    events.delete('penalty');
    checks.push({ field: 'minXg', level: 'note', message: 'xG only exists for shots, so penalties are left out.' });
  }
  if (filter.goaliePulled && events.has('penalty')) {
    checks.push({ field: 'goaliePulled', level: 'note', message: 'No penalties were called with a goalie pulled in this game.' });
  }
  filter.events = [...events];

  if (!checks.some((c) => c.level !== 'note')) {
    checks.push({ field: 'json', level: 'note', message: 'Empty filter: showing every event in the game.' });
  }

  const ok = !checks.some((c) => c.level === 'error');
  return { ok, filter, checks, draft };
}

export function eventLabel(types: EventType[]): string {
  const s = [...types].sort().join(',');
  if (s === 'block,goal,miss,save') return 'Shot attempts (goals, saves, misses, blocks)';
  if (s === 'goal,save') return 'Shots on goal (goals + saves)';
  if (s === 'goal,miss,save') return 'Unblocked shot attempts';
  const names: Record<EventType, string> = { goal: 'Goals', save: 'Saves', miss: 'Missed shots', block: 'Blocked shots', penalty: 'Penalties' };
  return types.map((t) => names[t]).join(', ');
}

export function strengthLabel(s: Strength): string {
  return { EV: 'Even strength', PP: 'Power play', SH: 'Shorthanded' }[s];
}

export function roleLabel(r: PlayerRole): string {
  return { primary: 'As shooter, scorer or penalised player', assist: 'As assister', blocker: 'As shot blocker', any: 'Any involvement' }[r];
}

/** Short chips describing a checked filter, in the order a coach reads them. */
export function describe(f: CheckedFilter, game: Game): { key: keyof DraftFilter; text: string }[] {
  const out: { key: keyof DraftFilter; text: string }[] = [];
  const pl = (id: number) => game.players.find((p) => p.id === id)!;
  if (f.events.length) out.push({ key: 'events', text: eventLabel(f.events) });
  if (f.side) out.push({ key: 'team', text: game.teams[f.side].name });
  if (f.players.length) out.push({ key: 'players', text: f.players.map((id) => `#${pl(id).jersey} ${pl(id).last}`).join(', ') });
  if (f.players.length && f.playerRole !== 'primary') out.push({ key: 'playerRole', text: roleLabel(f.playerRole) });
  if (f.goalie) out.push({ key: 'goalie', text: `On ${pl(f.goalie).last}` });
  if (f.periods.length) out.push({ key: 'periods', text: f.periods.map((n) => game.periods.find((p) => p.n === n)!.label).join(', ') });
  if (f.from !== undefined || f.to !== undefined) {
    const maxLen = Math.max(...game.periods.map((p) => p.length));
    out.push({ key: 'from', text: `${fmtClock(f.from ?? 0)}–${fmtClock(f.to ?? maxLen)}` });
  }
  if (f.strength.length) out.push({ key: 'strength', text: f.strength.map(strengthLabel).join(', ') });
  if (f.goaliePulled) out.push({ key: 'goaliePulled', text: 'Goalie pulled' });
  if (f.minXg !== undefined) out.push({ key: 'minXg', text: `xG ≥ ${f.minXg.toFixed(2)}` });
  if (f.scoreState) out.push({ key: 'scoreState', text: f.scoreState[0].toUpperCase() + f.scoreState.slice(1) });
  return out;
}

/** Apply a suggestion: keys set to undefined are removed. */
export function applyPatch(draft: DraftFilter, patch: Record<string, unknown>): DraftFilter {
  const next: Record<string, unknown> = { ...draft };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return next as DraftFilter;
}
