// Video seconds <-> game clock for a goal clip synced by scripts/sync-clips.ts.
//
// While the game clock runs it drops one second per video second, so one number per clip ties
// the two together: offset = remaining period seconds + video seconds.
//
// "Video seconds" count from the first frame of the goal footage. Liiga's stream puts a short
// pre-roll ad in front of it, so in the player: stream time = adEnd + video second.

import type { ClipSync, Game, GameEvent } from './types.ts';

/**
 * Where the pre-roll ad ends in Liiga's stream: the start of the first piece of video after the
 * stream's first discontinuity (HLS counts them in `cc`). 0 when the stream has no ad.
 */
export const adEnd = (fragments: { cc: number; start: number }[]) => fragments.find((f) => f.cc > 0)?.start ?? 0;

/**
 * Video second at which the game clock showed `clock` (seconds elapsed in the period).
 * Liiga logs whole seconds, so +0.5 lands in the middle of that second.
 */
export const videoSecond = (offset: number, periodLength: number, clock: number) => offset - (periodLength - clock) + 0.5;

/** Seconds elapsed in the period at video second `s`. */
export const clockAt = (sync: ClipSync, s: number) => sync.periodLength - (sync.offset! - s);

/** Events of the clip's period that happen on screen, from the start of the clip up to the goal. */
export function eventsInClip(sync: ClipSync, game: Game): { e: GameEvent; at: number }[] {
  const goal = game.events.find((e) => e.id === sync.event);
  if (!goal || sync.offset === null || sync.goalAt === null) return [];
  return game.events
    .filter((e) => e.period === goal.period)
    .map((e) => ({ e, at: videoSecond(sync.offset!, sync.periodLength, e.clock) }))
    .filter(({ at }) => at >= 0 && at <= sync.goalAt! + 0.3)
    .sort((a, b) => a.at - b.at);
}
