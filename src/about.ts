// The parts of the page that describe the game and the data rather than answer a question:
// game telemetry, rink legend, "Data source" and the video step of "How it works".

import { $, esc } from './dom.ts';
import { game, syncs } from './game.ts';
import { DEFAULT_MODEL, FALLBACK_MODEL } from './shared/llm.ts';

const fmtDate = (iso: string, weekday = true) =>
  new Date(iso).toLocaleDateString('en-GB', {
    ...(weekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** <dl> rows; values are HTML (escape them at the call site). */
const dl = (rows: [string, string][]) => rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('');

export function renderAbout() {
  const shots = game.events.filter((e) => e.type !== 'penalty');
  const withPositions = shots.filter((e) => e.positions?.length).length;
  const synced = syncs.filter((s) => s.offset !== null);
  const exactStops = syncs.filter((s) => s.stop === 'exact').length;
  const syncFailures = syncs.reduce((n, s) => n + s.checks.filter((c) => c.level === 'error').length, 0);

  $('#game').innerHTML = dl([
    ['Final', esc(game.result)],
    ['League', `${esc(game.league)} ${esc(game.season)}`],
    ['Date', esc(fmtDate(game.date))],
    ['Arena', esc(game.venue)],
    ['Crowd', game.spectators.toLocaleString('en-GB')],
    ['Events', `${game.events.length} · ${shots.length} shots`],
    ['Source', `<a href="#data">Liiga public feed ↓</a>`],
  ]);

  const { home, away } = game.teams;
  $('#legend-home').innerHTML = `<i style="background:${home.color}"></i><b>${esc(home.name)}</b> shoots →`;
  $('#legend-away').innerHTML = `<i style="background:${away.color}"></i>← <b>${esc(away.name)}</b> shoots`;

  // Liiga's live URL next to the copy this site keeps (public/liiga/<id>/)
  const [urlGame, urlShots, urlStats] = game.source.urls;
  const feed = (url: string, copy: string) =>
    `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url.replace(/^https:\/\//, ''))} ↗</a>
     <a class="copy" href="/liiga/${esc(game.id)}/${copy}.json" target="_blank">copy here ↗</a>`;
  const pp = game.source.ppCheck;

  $('#source').innerHTML = `
    <p class="src-intro">Every event, player and number on this page comes from <b>${esc(game.source.name)}</b>: the same JSON that
    liiga.fi loads for its own game pages. No login, nothing typed in by hand. The feed was read once and a copy of each
    response is kept on this site, so the page never needs Liiga's servers to answer a question.</p>
    <dl class="src">${dl([
      ['Game', `${feed(urlGame, 'game')}<span>Line-ups, goals with assists, penalties, goalie pulls and the links to the goal clips.</span>`],
      [
        'Shot map',
        `${feed(urlShots, 'shotmap')}<span>All ${shots.length} shot attempts: rink x/y, xG and result. For ${withPositions} of them, where all 12 players stood.</span>`,
      ],
      ['Stats', `${feed(urlStats, 'stats')}<span>Goalie time on ice per period, to know who was in net for each shot.</span>`],
      [
        'Clips',
        `videos.liiga.fi<span>The ${game.events.filter((e) => e.clip).length} official goal clips, copied onto this site (scripts/fetch-clips.ts). Liiga's own stream is the fallback.</span>`,
      ],
      [
        'Video sync',
        `scripts/sync-clips.ts<span>Read the scoreboard in our copies of the clips with Tesseract OCR, once, and saved the result
        (src/data/clip-sync.json): ${synced.length} of ${syncs.length} clips synced to the game clock, ${syncFailures} failed checks.</span>`,
      ],
      [
        'My code',
        `scripts/build-game.ts<span>Read the feed on ${esc(fmtDate(game.source.fetched, false))} and turned it into one list of ${game.events.length} events.
        It adds what the feed doesn't say per shot: strength (PP / SH / EV, 5v3, 6v5) from the penalty timeline, score state and the
        goalie in net. Check: its power-play label matches the feed's own on ${pp.agree} of ${pp.shots} shots.</span>`,
      ],
      [
        'The model',
        `${esc(DEFAULT_MODEL)}<span>Via OpenRouter, with ${esc(FALLBACK_MODEL)} as the backup. It only writes the filter JSON and never sees a player or an event. Repeated questions come from a cache.</span>`,
      ],
    ])}</dl>`;

  $('#how-video').textContent =
    `Tesseract, a neural-network OCR, read the broadcast scoreboard (clock, period, score, power-play strip) in 4 frames a ` +
    `second of every goal clip. Plain code kept only readings that fit a clock running one second per video second and ` +
    `checked them against Liiga's data: ${synced.length} of ${syncs.length} clips line up with the game clock, and in ` +
    `${exactStops} the clock stops at Liiga's exact goal time. Done once offline and saved; open a clip (▶ Clip) to see ` +
    `the game clock follow the video.`;
}
