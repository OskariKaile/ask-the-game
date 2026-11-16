// The saved result of scripts/sync-clips.ts (scoreboard OCR on the goal clips).
import { describe, expect, it } from 'vitest';
import gameJson from '../src/data/game.json';
import syncJson from '../src/data/clip-sync.json';
import { adEnd, clockAt, eventsInClip, videoSecond } from '../src/shared/sync.ts';
import type { ClipSync, Game } from '../src/shared/types.ts';

const game = gameJson as unknown as Game;
const syncs = syncJson as unknown as ClipSync[];
const goals = game.events.filter((e) => e.type === 'goal' && e.clip);

describe('clip sync (scoreboard read from the video)', () => {
  it('has one synced entry per goal clip', () => {
    expect(syncs.map((s) => s.event).sort()).toEqual(goals.map((g) => g.id).sort());
    for (const s of syncs) expect(s.offset, s.event).not.toBeNull();
  });

  it('passes every check against the feed', () => {
    for (const s of syncs) expect(s.checks.filter((c) => c.level === 'error'), s.event).toEqual([]);
  });

  it('puts every goal inside its 60 s clip, after the clock was seen running', () => {
    for (const s of syncs) {
      expect(s.goalAt!).toBeGreaterThan(0);
      expect(s.goalAt!).toBeLessThan(60);
      expect(s.live![0]).toBeLessThanOrEqual(s.goalAt!);
    }
  });

  it("maps Liiga's goal time back to the same video second", () => {
    for (const s of syncs) {
      const goal = goals.find((g) => g.id === s.event)!;
      expect(videoSecond(s.offset!, s.periodLength, goal.clock)).toBeCloseTo(s.goalAt!, 1);
      expect(clockAt(s, s.goalAt!)).toBeCloseTo(goal.clock + 0.5, 1);
    }
  });

  it('lists the goal as the last event in its own clip', () => {
    for (const s of syncs) {
      const seen = eventsInClip(s, game);
      expect(seen.at(-1)?.e.id).toBe(s.event);
    }
  });

  it('sees the clock stop at the exact goal time in most clips', () => {
    expect(syncs.filter((s) => s.stop === 'exact').length).toBeGreaterThanOrEqual(7);
    expect(syncs.some((s) => s.stop === 'mismatch')).toBe(false);
  });
});

describe("Liiga's pre-roll ad", () => {
  it('ends where the first piece of video after a discontinuity starts', () => {
    // as in Liiga's playlists: one 2.987 s ad piece, a discontinuity, then 6 s pieces of goal footage
    const fragments = [
      { cc: 0, start: 0 },
      { cc: 1, start: 2.987 },
      { cc: 1, start: 8.987 },
    ];
    expect(adEnd(fragments)).toBe(2.987);
  });

  it('is 0 when the stream has no ad', () => {
    expect(adEnd([{ cc: 0, start: 0 }, { cc: 0, start: 6 }])).toBe(0);
  });
});
