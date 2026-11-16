// The goal-clip player.
//
// Video: this site's own copy of Liiga's clip first (HLS in 6-second pieces under /clips/<id>/;
// static hosting has no byte-range support, so a single MP4 couldn't seek or play on iPhones),
// then Liiga's own stream, then a plain message.
//
// Sync: the game clock read from the video's scoreboard (src/data/clip-sync.json, made once by
// scripts/sync-clips.ts) drives a live game-clock readout, a jump to the goal and the list of
// events inside the clip.

import { $, esc, ICON } from './dom.ts';
import { game, periodLabel, playerName, syncs, what } from './game.ts';
import { fmtClock } from './shared/check.ts';
import { clockAt, eventsInClip } from './shared/sync.ts';
import type { ClipSync, GameEvent } from './shared/types.ts';

const dialog = $<HTMLDialogElement>('#clip-dialog');
const video = $<HTMLVideoElement>('#clip-video');
const clipMsg = $('#clip-msg');
const syncById = new Map(syncs.map((s) => [s.id, s]));

let hls: { destroy(): void } | undefined;
let lastOpener: HTMLElement | undefined;
let clipRun = 0; // ignores late events from a clip that was closed or replaced
let active: { sync: ClipSync; goal: GameEvent } | undefined;

/** The UUID in Liiga's clip URL; our copy lives under /clips/<id>/. */
const clipId = (url: string) => url.split('/videos/')[1]?.split('/')[0] ?? '';
const fmtVideo = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** Opens a goal clip; with `startAt` (video seconds) it starts 2 s before that moment. */
export function playClip(url: string, opener: HTMLElement, startAt?: number) {
  lastOpener = opener;
  const run = ++clipRun;
  const id = clipId(url);
  const start = startAt !== undefined ? Math.max(0, startAt - 2) : 0;
  video.hidden = false;
  clipMsg.hidden = true;
  video.poster = `/clips/${id}/poster.jpg`;
  showSync(syncById.get(id), start);
  dialog.showModal();
  playHls(`/clips/${id}/index.m3u8`, run, start, () => {
    showSync(undefined); // Liiga's stream starts with a 3 s ad, so our timings wouldn't fit it
    playHls(url, run, 0, () => clipFailed(url));
  });
}

async function playHls(src: string, run: number, start: number, onFail: () => void) {
  hls?.destroy();
  hls = undefined;
  video.onerror = null;
  // hls.js wherever Media Source works; some browsers answer "maybe" for native HLS and then fail
  let Hls: typeof import('hls.js').default | undefined;
  try {
    Hls = (await import('hls.js')).default;
  } catch {
    Hls = undefined; // still try the browser's own HLS (Safari, iPhone)
  }
  if (run !== clipRun) return;
  if (Hls?.isSupported()) {
    const h = new Hls(start > 0 ? { startPosition: start } : {});
    h.on(Hls.Events.ERROR, (_ev, data) => {
      if (data.fatal && run === clipRun) {
        h.destroy();
        if (hls === h) hls = undefined;
        onFail();
      }
    });
    h.loadSource(src);
    h.attachMedia(video);
    hls = h;
  } else {
    video.onerror = () => {
      if (run === clipRun) onFail();
    };
    if (start > 0) {
      video.addEventListener('loadedmetadata', () => run === clipRun && (video.currentTime = start), { once: true });
    }
    video.src = src;
  }
  video.play().catch(() => {});
}

/** Neither our copy nor Liiga's stream played: say so plainly. */
function clipFailed(url: string) {
  const e = game.events.find((x) => x.clip?.url === url);
  video.hidden = true;
  clipMsg.hidden = false;
  clipMsg.textContent = `This clip couldn't load, from this site or from Liiga's video service.${
    e ? ` The goal is at ${periodLabel(e.period)} ${fmtClock(e.clock)} (${playerName(e.player)}).` : ''
  } Everything else on the page works without it.`;
}

// ---------- the sync panel ----------

function showSync(sync: ClipSync | undefined, start = 0) {
  const box = $('#clip-sync');
  active = undefined;
  box.hidden = !sync || sync.offset === null || sync.goalAt === null;
  if (box.hidden || !sync) return;
  const goal = game.events.find((e) => e.id === sync.event)!;
  active = { sync, goal };

  $('#sync-goal').textContent = `▶ Goal at ${fmtVideo(sync.goalAt!)}`;

  const events = $('#sync-events');
  events.innerHTML = eventsInClip(sync, game)
    .map(
      ({ e, at }) => `<button class="sync-ev ${e.type}" data-at="${at}" title="Jump to ${fmtVideo(at)}">
        <span>${fmtVideo(at)}</span> ${periodLabel(e.period)} ${fmtClock(e.clock)} · ${esc(game.teams[e.side].name)} ${what(e)} · ${esc(playerName(e.player))}</button>`,
    )
    .join('');
  events
    .querySelectorAll<HTMLButtonElement>('.sync-ev')
    .forEach((b) => b.addEventListener('click', () => seek(Number(b.dataset.at) - 2)));

  const failed = sync.checks.filter((c) => c.level === 'error').length;
  const passed = sync.checks.filter((c) => c.level === 'ok').length;
  $('#sync-summary').textContent = failed
    ? `${failed} of the video checks failed`
    : `How this was checked: ${passed} checks against Liiga's data passed`;
  $('#sync-checks').innerHTML = sync.checks
    .map((c) => `<li class="${c.level}"><span class="ico" aria-label="${c.level}">${ICON[c.level]}</span><div>${esc(c.text)}</div></li>`)
    .join('');

  updateSyncNow(start); // the video element still holds the previous clip's position
}

/** Game clock for the current video second, and which events have already happened. */
function updateSyncNow(at?: number) {
  if (!active) return;
  const { sync, goal } = active;
  const s = at ?? video.currentTime;
  const now = $('#sync-now');
  const state = $('#sync-state');
  if (s <= sync.goalAt! + 0.3) {
    now.textContent = `${periodLabel(goal.period)} ${fmtClock(Math.max(0, Math.floor(clockAt(sync, s))))}`;
    const [from, to] = sync.live!;
    state.textContent = s >= from - 0.5 && s <= to + 0.5 ? 'scoreboard on screen' : 'scoreboard off screen, same clock';
  } else {
    now.textContent = `${periodLabel(goal.period)} ${fmtClock(goal.clock)}`;
    state.textContent = 'goal: clock stopped, replays follow';
  }
  $('#sync-events')
    .querySelectorAll<HTMLButtonElement>('.sync-ev')
    .forEach((b) => b.classList.toggle('past', Number(b.dataset.at) <= s));
}

function seek(s: number) {
  video.currentTime = Math.max(0, s);
  video.play().catch(() => {});
}

// ---------- wiring ----------

$('#sync-goal').addEventListener('click', () => active && seek(active.sync.goalAt! - 4));
video.addEventListener('timeupdate', () => updateSyncNow());
video.addEventListener('seeked', () => updateSyncNow());
$('#clip-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  clipRun++;
  active = undefined;
  video.onerror = null;
  video.pause();
  hls?.destroy();
  hls = undefined;
  video.removeAttribute('src');
  video.load();
  lastOpener?.focus();
});
