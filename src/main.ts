// The page: ask a question, show what the model drafted, what the check made of it, and the
// matching events as a list and on the rink.

import './fonts.ts';
import './style.css';
import { renderAbout } from './about.ts';
import { $, esc, ICON } from './dom.ts';
import { downloadClipList } from './export.ts';
import { describeEvent, game, inClip, periodLabel, player, playerName, what } from './game.ts';
import { playClip } from './player.ts';
import { buildRink, drawEvents, setHover } from './rink.ts';
import { applyPatch, checkDraft, describe, fmtClock } from './shared/check.ts';
import { runQuery, summarize } from './shared/query.ts';
import type { CheckResult, GameEvent } from './shared/types.ts';

// ---------- state ----------

let question = '';
let modelRaw: string | null = null; // the model's answer, exactly as it came back
let modelMeta = '';
let edited = false; // the filter was changed by hand (or by a suggestion button)
let busy = false;
let apiError = '';
let result: CheckResult = checkDraft({}, game);
let events: GameEvent[] = runQuery(result.filter, game);
let selected: string | undefined;
let hovered: string | undefined;

const layer = buildRink($<HTMLElement>('#rink') as unknown as SVGSVGElement);

// ---------- asking ----------

async function ask(q: string) {
  question = q.trim();
  if (!question || busy) return;
  busy = true;
  apiError = '';
  render();
  try {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    modelRaw = data.draft;
    modelMeta = data.cached
      ? `${data.model} · cached (asked before, no new model call)`
      : `${data.model} · ${(data.ms / 1000).toFixed(1)} s`;
    edited = false;
    setResult(checkDraft(modelRaw, game));
  } catch (err) {
    apiError = err instanceof Error ? err.message : String(err);
  } finally {
    busy = false;
    render();
  }
}

function setResult(r: CheckResult) {
  result = r;
  events = r.ok ? runQuery(r.filter, game) : [];
  if (!events.some((e) => e.id === selected)) selected = undefined;
}

function patchDraft(patch: Record<string, unknown>) {
  edited = true;
  setResult(checkDraft(applyPatch(result.draft, patch), game));
  render();
}

// ---------- the three pipeline steps ----------

function renderPipeline() {
  renderDraft();
  renderCheck();
  renderSearched();
}

/** Step 1: the model's raw draft (or the hand-edited one). */
function renderDraft() {
  const box = $('#step-model');
  if (busy) {
    box.innerHTML = `<p class="muted pulse">Asking the model…</p>`;
  } else if (apiError) {
    box.innerHTML = `<p class="err">${esc(apiError)}</p><button class="link" id="edit">Write the filter by hand</button>`;
  } else if (modelRaw === null && !edited) {
    box.innerHTML = `<p class="muted">Ask a question, or pick one below. The model's raw JSON shows up here, before any check.</p>
      <button class="link" id="edit">Or write a filter by hand</button>`;
  } else {
    const shown = edited ? compact(result.draft) : prettify(modelRaw ?? '');
    box.innerHTML = `${question && !edited ? `<p class="q">“${esc(question)}”</p>` : ''}
      <pre class="json">${highlight(shown)}</pre>
      <p class="meta">${edited ? '<span class="tag">edited by you</span>' : esc(modelMeta)}</p>
      <button class="link" id="edit">Edit by hand</button>
      ${edited && modelRaw ? `<details><summary>Model's original answer</summary><pre class="json">${highlight(prettify(modelRaw))}</pre></details>` : ''}`;
  }
  $('#edit')?.addEventListener('click', openEditor);
}

/** Step 2: every check, with one-click fixes. */
function renderCheck() {
  const box = $('#step-check');
  if (busy) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `<ul class="checks">${result.checks
    .map((c, i) => {
      const input = c.input !== undefined ? `<code>${esc(c.input)}</code> ${c.level !== 'error' ? '→ ' : ''}` : '';
      const fixes = c.suggestions?.length
        ? `<div class="sugg">${c.suggestions
            .map((s, j) => `<button class="btn btn--cyan btn--sm" data-c="${i}" data-s="${j}">${esc(s.label)}</button>`)
            .join('')}</div>`
        : '';
      return `<li class="${c.level}">
        <span class="ico" aria-label="${c.level}">${ICON[c.level]}</span>
        <div>${input}${esc(c.message)}${fixes}</div></li>`;
    })
    .join('')}</ul>`;
  box.querySelectorAll<HTMLButtonElement>('.sugg button').forEach((b) =>
    b.addEventListener('click', () => patchDraft(result.checks[Number(b.dataset.c)].suggestions![Number(b.dataset.s)].patch)),
  );
}

/** Step 3: what was actually searched, as removable chips, and the answer. */
function renderSearched() {
  const box = $('#step-search');
  if (busy) {
    box.innerHTML = '';
    return;
  }
  if (!result.ok) {
    box.innerHTML = `<p class="err">Not searched. Fix or remove the red items first, so the results never answer a different question than the one you asked.</p>`;
    return;
  }
  const chips = describe(result.filter, game);
  box.innerHTML = `<div class="chips">${
    chips.length
      ? chips.map((c) => `<span class="chip">${esc(c.text)}<button aria-label="Remove ${esc(c.text)}" data-k="${c.key}">×</button></span>`).join('')
      : '<span class="chip all">Whole game</span>'
  }</div><p class="answer">${esc(summarize(events, result.filter, game))}</p>`;
  box.querySelectorAll<HTMLButtonElement>('.chip button').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.k!;
      const patch: Record<string, unknown> = { [k]: undefined };
      if (k === 'from') patch.to = undefined;
      if (k === 'players') patch.playerRole = undefined;
      if (k === 'events' && result.draft.unsupported) patch.unsupported = undefined;
      patchDraft(patch);
    }),
  );
}

/** One key per line, values on the same line: easy to read at a glance. */
function compact(obj: object): string {
  const rows = Object.entries(obj).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return rows.length ? `{\n${rows.join(',\n')}\n}` : '{}';
}

/** The model's text as compact JSON, or as it came if it isn't JSON. */
function prettify(raw: string): string {
  try {
    const t = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
    return compact(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)));
  } catch {
    return raw;
  }
}

/** Escape, then colour keys amber and values cyan (one key per line, as compact() writes it). */
const highlight = (text: string) =>
  esc(text).replace(/^(\s*)(&quot;.*?&quot;)(:\s?)(.*?)(,?)$/gm, '$1<span class="k">$2</span>$3<span class="v">$4</span>$5');

function openEditor() {
  const box = $('#step-model');
  box.innerHTML = `<textarea id="draft-edit" spellcheck="false" aria-label="Filter JSON">${esc(compact(result.draft))}</textarea>
    <div class="row"><button id="run-edit" class="btn btn--sm">Check and search</button><button class="link" id="cancel-edit">Cancel</button></div>
    <p class="meta">Same check as the model's output gets. Try a player who didn't play, or "period": 6.</p>`;
  $('#run-edit').addEventListener('click', () => {
    edited = true;
    apiError = '';
    setResult(checkDraft($<HTMLTextAreaElement>('#draft-edit').value, game));
    render();
  });
  $('#cancel-edit').addEventListener('click', render);
  $<HTMLTextAreaElement>('#draft-edit').focus();
}

// ---------- results: rink + list ----------

function renderResults() {
  drawEvents(layer, events, game, {
    selected,
    label: describeEvent,
    onPick: (id) => {
      toggleSelected(id);
      document.querySelector(`[data-row="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    onHover: hover,
  });

  const offRink = events.filter((e) => e.x === undefined).length;
  $('#rink-note').textContent = !result.ok
    ? 'Nothing searched yet.'
    : `${events.length - offRink} on the rink${offRink ? `, ${offRink} penalt${offRink === 1 ? 'y' : 'ies'} in the list only (no rink position)` : ''}. Click a shot to see where all 12 players stood.`;

  const sel = events.find((e) => e.id === selected);
  $('#onice-note').hidden = !sel;
  if (sel) {
    $('#onice-note').textContent = sel.positions
      ? `Showing the player positions the feed recorded for ${describeEvent(sel)}. Cyan ring = shooter.`
      : `The feed has no player positions for this event.`;
  }

  const list = $('#list');
  list.innerHTML = result.ok ? events.map(listRow).join('') : '';
  list.querySelectorAll<HTMLLIElement>('li').forEach((li) => {
    const id = li.dataset.row!;
    li.addEventListener('click', (ev) => {
      if (!(ev.target as HTMLElement).closest('.clip')) toggleSelected(id);
    });
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') toggleSelected(id);
    });
    li.addEventListener('mouseenter', () => hover(id));
    li.addEventListener('mouseleave', () => hover(undefined));
  });
  list
    .querySelectorAll<HTMLButtonElement>('.clip')
    .forEach((b) => b.addEventListener('click', () => playClip(b.dataset.clip!, b, b.dataset.at ? Number(b.dataset.at) : undefined)));
  $<HTMLButtonElement>('#export').disabled = !events.length;
}

function listRow(e: GameEvent): string {
  const p = player(e.player)!;
  const home = e.side === 'home' ? e.scoreFor : e.scoreAgainst;
  const away = e.side === 'home' ? e.scoreAgainst : e.scoreFor;
  const situation = `${e.strength === 'EV' ? 'Even' : e.strength} ${e.manpower}${e.extraAttacker ? ', goalie pulled' : ''}${e.emptyNet ? ', empty net' : ''}`;
  const details = [
    situation,
    `score ${home}–${away}`,
    e.type === 'block' && e.blocker ? `blocked by ${playerName(e.blocker)}` : '',
    e.type === 'save' && e.goalie ? `saved by ${playerName(e.goalie)}` : '',
    e.type === 'goal' && e.assists?.length ? `assists ${e.assists.map(playerName).join(', ')}` : '',
    e.type === 'goal' && !e.assists?.length ? 'unassisted' : '',
    e.penalty ? `${e.penalty.name}, ${e.penalty.minutes} min${e.penalty.coincidental ? ' (coincidental)' : ''}` : '',
    ...(e.tags ?? []),
  ].filter(Boolean);

  // goals have their own clip; a few shots can be seen in a goal clip (from the scoreboard sync)
  const seen = e.clip ? undefined : inClip.get(e.id);
  const video = e.clip
    ? `<button class="clip btn btn--cyan btn--sm" data-clip="${esc(e.clip.url)}" aria-label="Play the goal clip">▶ Clip</button>`
    : seen
      ? `<button class="clip btn btn--cyan btn--sm" data-clip="${esc(seen.url)}" data-at="${seen.at}" title="Seen ${seen.at} s into a goal clip (synced from the scoreboard clock)">▶ Video</button>`
      : '';

  return `<li data-row="${e.id}" class="${e.id === selected ? 'sel' : ''}${e.id === hovered ? ' hl' : ''} ${e.type}" tabindex="0">
    <span class="when">${periodLabel(e.period)}<b>${fmtClock(e.clock)}</b></span>
    <span class="dot" style="--c:${game.teams[e.side].color}"></span>
    <span class="main"><b>${esc(game.teams[e.side].name)} · ${what(e, true)}</b> · #${p.jersey} ${esc(p.first)} ${esc(p.last)}
      <small>${esc(details.join(' · '))}</small></span>
    <span class="xg">${e.xg !== undefined ? `xG ${e.xg.toFixed(2)}` : ''}${video}</span>
  </li>`;
}

function toggleSelected(id: string) {
  selected = selected === id ? undefined : id;
  render();
}

/** Hover highlight on both the list and the rink, without redrawing either. */
function hover(id?: string) {
  hovered = id;
  setHover(layer, id);
  document.querySelectorAll<HTMLLIElement>('#list li').forEach((li) => li.classList.toggle('hl', li.dataset.row === id));
}

function render() {
  $<HTMLButtonElement>('#ask-btn').disabled = busy;
  renderPipeline();
  renderResults();
}

// ---------- examples ----------

interface Example { q: string; why: string }

const EXAMPLES: Example[] = [
  { q: 'Ässät power play shots in the third', why: '' },
  { q: 'Every goal #94 was involved in', why: '' },
  { q: 'Dangerous Ässät chances while they were trailing', why: '' },
  { q: 'Saves by Saarinen in the last five minutes of the 3rd', why: '' },
  { q: 'Ässät:n maalit kuudella viittä vastaan', why: 'Finnish' },
  { q: 'Alle Tore in der Verlängerung', why: 'German' },
];
const BREAK: Example[] = [
  { q: 'Shots by #8', why: 'two players wore #8' },
  { q: 'Hits by Hakulinnen', why: 'typo + no hit data' },
  { q: 'Goals by Mäkinen', why: "didn't dress" },
  { q: 'Goals in the 5th period', why: 'no such period' },
];
const exampleButton = (e: Example) =>
  `<button class="ex" data-q="${esc(e.q)}">${esc(e.q)}${e.why ? `<small>${esc(e.why)}</small>` : ''}</button>`;

// ---------- start ----------

renderAbout();
$('#examples').innerHTML = EXAMPLES.map(exampleButton).join('');
$('#break').innerHTML = BREAK.map(exampleButton).join('');
document.querySelectorAll<HTMLButtonElement>('.ex').forEach((b) =>
  b.addEventListener('click', () => {
    $<HTMLInputElement>('#q').value = b.dataset.q!;
    ask(b.dataset.q!);
  }),
);
$<HTMLFormElement>('#ask').addEventListener('submit', (ev) => {
  ev.preventDefault();
  ask($<HTMLInputElement>('#q').value);
});
$('#export').addEventListener('click', () => downloadClipList(events));
render();
