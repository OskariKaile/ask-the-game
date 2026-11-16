// Shared types for the game data, the model's draft filter and the checked filter.
// Plain types only (no enums), so Node can run the scripts with type stripping.

export type Side = 'home' | 'away';

/** Event types that exist in Liiga's public game feed. */
export type EventType = 'goal' | 'save' | 'miss' | 'block' | 'penalty';

/** Manpower from the acting team's point of view, derived from the penalty timeline. */
export type Strength = 'EV' | 'PP' | 'SH';

export type ScoreState = 'leading' | 'tied' | 'trailing';

/** Which part a player played in an event. */
export type PlayerRole = 'primary' | 'assist' | 'blocker' | 'any';

export interface Team {
  side: Side;
  name: string;
  color: string;
  goals: number;
  xg: number;
}

export interface Player {
  id: number;
  side: Side;
  jersey: number;
  first: string;
  last: string;
  /** C, LW, RW, D or G */
  pos: string;
  /** false = on the club roster but not dressed for this game */
  dressed: boolean;
}

export interface Period {
  n: number;
  label: string;
  /** seconds */
  length: number;
}

export interface OnIcePosition {
  player: number;
  x: number;
  y: number;
}

export interface GameEvent {
  id: string;
  type: EventType;
  period: number;
  /** seconds since puck drop */
  t: number;
  /** seconds since the start of the period */
  clock: number;
  /** team that did it: shooting team or penalised team */
  side: Side;
  /** shooter, scorer or penalised player */
  player: number;
  assists?: number[];
  /** skater who blocked the shot */
  blocker?: number;
  /** goalie in the net the shot went at (absent = empty net) */
  goalie?: number;
  /** rink position, 0-1000 x 0-500 (60 m x 30 m), home team always attacks to the right */
  x?: number;
  y?: number;
  xg?: number;
  strength: Strength;
  /** for example 5v4, 3v3, 6v5 */
  manpower: string;
  /** the acting team had pulled its goalie */
  extraAttacker?: boolean;
  /** the other team's net was empty */
  emptyNet?: boolean;
  scoreFor: number;
  scoreAgainst: number;
  scoreState: ScoreState;
  penalty?: { code: string; name: string; minutes: number; coincidental: boolean };
  /** goal labels such as Power play, Extra attacker, Game winner */
  tags?: string[];
  clip?: { url: string; thumb?: string };
  positions?: OnIcePosition[];
}

export interface Game {
  id: string;
  league: string;
  season: string;
  date: string;
  venue: string;
  spectators: number;
  result: string;
  teams: Record<Side, Team>;
  periods: Period[];
  players: Player[];
  events: GameEvent[];
  source: { name: string; urls: string[]; fetched: string; ppCheck: { agree: number; shots: number } };
}

/**
 * What the model is asked to return. Every value is loose on purpose (strings as the
 * user wrote them): resolving them against the real game is the code's job, not the model's.
 */
export interface DraftFilter {
  events?: string[];
  team?: string;
  players?: string[];
  playerRole?: string;
  goalie?: string;
  periods?: (number | string)[];
  from?: string;
  to?: string;
  strength?: string[];
  goaliePulled?: boolean;
  minXg?: number;
  scoreState?: string;
  unsupported?: string[];
}

/** What the code runs, after every value was checked against the game. */
export interface CheckedFilter {
  events: EventType[];
  side?: Side;
  players: number[];
  playerRole: PlayerRole;
  goalie?: number;
  periods: number[];
  /** seconds since the start of the period */
  from?: number;
  to?: number;
  strength: Strength[];
  goaliePulled?: boolean;
  minXg?: number;
  scoreState?: ScoreState;
}

export type IssueLevel = 'ok' | 'fixed' | 'note' | 'error';

export interface Suggestion {
  label: string;
  /** keys set to undefined are removed from the draft */
  patch: Partial<Record<keyof DraftFilter, unknown>>;
}

export interface Check {
  field: keyof DraftFilter | 'json';
  level: IssueLevel;
  /** the value as the model wrote it */
  input?: string;
  message: string;
  suggestions?: Suggestion[];
}

export interface CheckResult {
  ok: boolean;
  filter: CheckedFilter;
  checks: Check[];
  draft: DraftFilter;
}

/**
 * One goal clip tied to the game clock by reading the scoreboard (scripts/sync-clips.ts).
 * "Video seconds" count from the first frame of the goal footage, i.e. after Liiga's pre-roll ad.
 */
export interface SyncCheck { level: 'ok' | 'note' | 'error'; text: string }
export interface ClipSync {
  /** clip id (the UUID in Liiga's clip URL) */
  id: string;
  /** the goal event this clip shows */
  event: string;
  /** frames sampled (4 per second) */
  frames: number;
  /** frames where the OCR read a clock value */
  clockReads: number;
  /** readings that fit a clock running one second per video second */
  used: number;
  periodLength: number;
  /** remaining period seconds + video seconds while the clock runs; null = not synced */
  offset: number | null;
  /** video second of the goal */
  goalAt: number | null;
  /** video seconds where the running clock was on screen */
  live: [number, number] | null;
  /** where the scoreboard clock froze, compared with Liiga's goal time */
  stop: 'exact' | 'within-1s' | 'not-visible' | 'mismatch';
  checks: SyncCheck[];
}
