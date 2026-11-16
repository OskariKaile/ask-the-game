// The goal-clip player.
//
// Video: Liiga's own stream (videos.liiga.fi), exactly as Liiga serves it, pre-roll ad included.
// hls.js wherever Media Source works; the browser's own HLS otherwise (older iPhones).
//
// Sync: the game clock read from the video's scoreboard (src/data/clip-sync.json, made once
// offline by scripts/sync-clips.ts) drives a live game-clock readout, a jump to the goal and the
// list of events inside the clip. Those times count from the end of the ad, so the player shifts
// them by the ad's length, which hls.js reads from the stream's playlist (adEnd in shared/sync.ts).

import { $, esc, ICON } from './dom.ts';
import { game, periodLabel, playerName, syncs, what } from './game.ts';
import { fmtClock } from './shared/check.ts';
import { adEnd, clockAt, eventsInClip } from './shared/sync.ts';
import type { ClipSync, GameEvent } from './shared/types.ts';

const dialog = $<HTMLDialogElement>('#clip-dialog');
const video = $<HTMLVideoElement>('#clip-video');
const clipMsg = $('#clip-msg');
const syncById = new Map(syncs.map((s) => [s.id, s]));

let hls: { destroy(): void } | undefined;
let lastOpener: HTMLElement | undefined;
let clipRun = 0; // ignores late events from a clip that was closed or replaced
/** The synced clip on screen. `ad`: seconds of pre-roll ad in front of the goal footage. */
let active: { sync: ClipSync; goal: GameEvent; ad: number } | undefined;

/** The UUID in Liiga's clip URL. */
const clipId = (url: string) => url.split('/videos/')[1]?.split('/')[0] ?? '';
const fmtVideo = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** Opens a goal clip. With `startAt` (video seconds, counted after the ad) it starts 2 s before that moment. */
export function playClip(url: string, opener: HTMLElement, startAt?: number) {
  lastOpener = opener;
  const run = ++clipRun;
  video.hidden = false;
  clipMsg.hidden = true;
  video.poster = game.events.find((e) => e.clip?.url === url)?.clip?.thumb ?? '';
  showSync(undefined); // until the stream says where the ad ends
  dialog.showModal();
  play(url, run, (ad) => {
    const start = startAt !== undefined ? Math.max(0, ad + startAt - 2) : undefined;
    showSync(syncById.get(clipId(url)), ad, start);
    if (start !== undefined) seekWhenReady(run, start);
  });
}

/** Plays Liiga's HLS stream. `onAd` gets the ad's length once hls.js has read the playlist. */
async function play(url: string, run: number, onAd: (ad: number) => void) {
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
    const h = new Hls();
    // the playlist arrives before any video, so the sync is ready before the first frame
    h.once(Hls.Events.LEVEL_LOADED, (_ev, { details }) => run === clipRun && onAd(adEnd(details.fragments)));
    h.on(Hls.Events.ERROR, (_ev, data) => data.fatal && run === clipRun && clipFailed(url));
    h.loadSource(url);
    h.attachMedia(video);
    hls = h;
  } else {
    // The browser's own HLS plays the stream but doesn't say where the ad ends: no sync panel.
    video.onerror = () => run === clipRun && clipFailed(url);
    video.src = url;
  }
  video.play().catch(() => {});
}

/** Liiga's stream didn't play: say so plainly. */
function clipFailed(url: string) {
  hls?.destroy();
  hls = undefined;
  showSync(undefined);
  const e = game.events.find((x) => x.clip?.url === url);
  video.hidden = true;
  clipMsg.hidden = false;
  clipMsg.textContent = `This clip couldn't load from Liiga's video service.${
    e ? ` The goal is at ${periodLabel(e.period)} ${fmtClock(e.clock)} (${playerName(e.player)}).` : ''
  } Everything else on the page works without it.`;
}

// ---------- the sync panel ----------
// Times shown and stored in the panel are stream seconds (what the video's own timeline shows).

function showSync(sync: ClipSync | undefined, ad = 0, at?: number) {
  const box = $('#clip-sync');
  const goal = sync && game.events.find((e) => e.id === sync.event);
  active = sync && goal && sync.offset !== null && sync.goalAt !== null ? { sync, goal, ad } : undefined;
  box.hidden = !active;
  if (!sync || !active) return;

  $('#sync-goal').textContent = `▶ Goal at ${fmtVideo(ad + sync.goalAt!)}`;

  const events = $('#sync-events');
  events.innerHTML = eventsInClip(sync, game)
    .map(({ e, at: s }) => {
      const t = ad + s;
      return `<button class="sync-ev ${e.type}" data-at="${t}" title="Jump to ${fmtVideo(t)}">
        <span>${fmtVideo(t)}</span> ${periodLabel(e.period)} ${fmtClock(e.clock)} · ${esc(game.teams[e.side].name)} ${what(e)} · ${esc(playerName(e.player))}</button>`;
    })
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

  updateSyncNow(at);
}

/** Game clock at stream second `at` (default: now), and which events have already happened. */
function updateSyncNow(at = video.currentTime) {
  if (!active) return;
  const { sync, goal, ad } = active;
  const s = at - ad; // video second of the goal footage
  const now = $('#sync-now');
  const state = $('#sync-state');
  if (s < 0) {
    now.textContent = '–';
    state.textContent = "Liiga's pre-roll ad";
  } else if (s <= sync.goalAt! + 0.3) {
    now.textContent = `${periodLabel(goal.period)} ${fmtClock(Math.max(0, Math.floor(clockAt(sync, s))))}`;
    const [from, to] = sync.live!;
    state.textContent = s >= from - 0.5 && s <= to + 0.5 ? 'scoreboard on screen' : 'scoreboard off screen, same clock';
  } else {
    now.textContent = `${periodLabel(goal.period)} ${fmtClock(goal.clock)}`;
    state.textContent = 'goal: clock stopped, replays follow';
  }
  $('#sync-events')
    .querySelectorAll<HTMLButtonElement>('.sync-ev')
    .forEach((b) => b.classList.toggle('past', Number(b.dataset.at) <= at));
}

function seek(s: number) {
  video.currentTime = Math.max(0, s);
  video.play().catch(() => {});
}

/** Seeks as soon as the video knows its length (setting currentTime earlier is ignored by some browsers). */
function seekWhenReady(run: number, s: number) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return seek(s);
  video.addEventListener('loadedmetadata', () => run === clipRun && seek(s), { once: true });
}

// ---------- wiring ----------

$('#sync-goal').addEventListener('click', () => active && seek(active.ad + active.sync.goalAt! - 4));
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
