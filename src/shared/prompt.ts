// The prompt that turns a coach's question into a draft filter.
// The model gets the shape of the game (teams, periods) but NOT the roster or the events:
// it translates language into structure, and the code resolves names and checks facts.
// That keeps the model from "knowing" players or counts it could get wrong.

import type { Game } from './types.ts';

export function systemPrompt(game: Game): string {
  const home = game.teams.home.name;
  const away = game.teams.away.name;
  const hasOT = game.periods.some((p) => p.label === 'OT');
  return `You turn a hockey coach's question about ONE game into a JSON search filter.
You do not answer the question and you never see the game data. Code checks your filter against the real game and runs the search.

The game: ${home} (home) vs ${away} (away), ${game.league}, ${game.date.slice(0, 10)}.
Periods: 1, 2, 3${hasOT ? ' and 4 (= overtime, 5 minutes, 3-on-3)' : ''}. The period clock counts up from 00:00 to 20:00${hasOT ? ' (overtime 00:00 to 05:00)' : ''}.

Return ONLY one JSON object. Use only these keys and leave out every key the question doesn't mention:
- "events": array of "goal", "save" (shot on goal that was saved), "miss" (shot that missed the net), "block" (shot blocked by a skater), "penalty", "shots" (shots on goal = goals + saves), "attempts" (all shot attempts = goals, saves, misses and blocks). Plain "shots" means "shots". "All shots", "shot attempts" or "Corsi" means "attempts".
- "team": the team that did it, "${home}" or "${away}" (or exactly as the user wrote it if it's another team). It's the shooting team for shots and the penalised team for penalties. "Shots against ${home}" means team "${away}".
- "players": array of players as the user wrote them: a name or a jersey number ("#94"), optionally with a team ("#25 ${home}"). Put Finnish or German inflected names in their base form ("Virtaselle" -> "Virtanen"), but never correct the spelling, complete or guess a name.
- "playerRole": "primary" (shooter, scorer or penalised player; this is the default, leave it out), "assist" (assisted the goal), "blocker" (blocked the shot) or "any" (involved in any of these ways, for example "points" or "everything with #94").
- "goalie": the goalie the shots were taken on, as the user wrote it. "Saves by X", "shots on X" and "goals against X" all use "goalie".
- "periods": array of numbers 1-${hasOT ? 4 : 3}${hasOT ? ' (4 = overtime)' : ''}. A shootout is period 5.
- "from", "to": period clock "mm:ss". "Last 5 minutes" = from "15:00" to "20:00". "First 10 minutes" = from "00:00" to "10:00". An absolute game minute like "the 45th minute" is period 3, from "04:00" to "05:00".
- "strength": array of "EV" (even strength, also 4-on-4 and 3-on-3), "PP" (power play), "SH" (shorthanded, penalty kill), from the point of view of the team that did it.
- "goaliePulled": true for 6-on-5, extra attacker or empty-net situations.
- "minXg": number from 0 to 1, the shot's minimum expected-goals value. "Dangerous", "high-danger", "grade A" or "quality" chances = 0.15 unless the user gives a number.
- "scoreState": "leading", "tied" or "trailing", from the point of view of "team" (or of each event's own team if there is no team).
- "unsupported": array of short phrases for every part of the question you can't express with the keys above, for example "hits", "faceoffs", "2-on-1 rushes", "passes", "shot types". Never drop part of the question silently.

The coach may write in English, Finnish, German or Swedish. Always answer with the English values listed above.`;
}

/**
 * A few worked examples. They teach the output shape more reliably than rules alone.
 * The names are made up on purpose (nobody called Lehtonen or Virtanen is on either roster), so the
 * prompt still holds no real roster data.
 */
export function examples(game: Game): { q: string; a: object }[] {
  const home = game.teams.home.name;
  const away = game.teams.away.name;
  return [
    { q: `${home} power play shots in the third`, a: { events: ['shots'], team: home, strength: ['PP'], periods: [3] } },
    { q: 'every goal #12 was involved in', a: { events: ['goal'], players: ['#12'], playerRole: 'any' } },
    { q: `${away}:n laukaukset Lehtoseen viimeisellä viidellä minuutilla`, a: { events: ['shots'], team: away, goalie: 'Lehtonen', from: '15:00', to: '20:00' } },
    { q: 'hits and blocked shots by Virtanen while tied', a: { events: ['block'], players: ["Virtanen"], scoreState: 'tied', unsupported: ['hits'] } },
  ];
}

export const EXAMPLE_NAMES = ["Lehtonen", "Virtanen"];
