// The clip list a coach would hand to video: one CSV row per matching event.

import { fmtClock } from './shared/check.ts';
import type { GameEvent } from './shared/types.ts';
import { game, inClip, periodLabel, playerName } from './game.ts';

const HEADER = [
  'period',
  'clock',
  'game_time_s',
  'clip_start_s', // a clip window around the event: 8 s before, 4 s after
  'clip_end_s',
  'team',
  'event',
  'player',
  'situation',
  'xg',
  'video_clip', // Liiga's goal clip the event can be seen in (scoreboard sync), if any
  'video_s_after_ad', // seconds into that clip, counted from the end of Liiga's pre-roll ad
];

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function downloadClipList(events: GameEvent[]) {
  const rows = [HEADER];
  for (const e of events) {
    const seen = inClip.get(e.id);
    rows.push([
      periodLabel(e.period),
      fmtClock(e.clock),
      String(e.t),
      String(Math.max(0, e.t - 8)),
      String(e.t + 4),
      game.teams[e.side].name,
      e.type,
      playerName(e.player),
      `${e.strength} ${e.manpower}`,
      e.xg?.toFixed(3) ?? '',
      seen?.url ?? '',
      seen ? String(seen.at) : '',
    ]);
  }
  const csv = rows.map((r) => r.map(cell).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `clips-${game.id}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
