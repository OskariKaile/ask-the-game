// Questions with the filter a hockey person would expect after the code check.
// A case passes only if the WHOLE checked filter matches: an extra constraint the coach
// didn't ask for changes the answer, so it counts as a miss.
// `alts` lists other readings that are also fair (e.g. "chances" = shots or all attempts).

import type { CheckedFilter } from '../src/shared/types.ts';

export type Want = Partial<Omit<CheckedFilter, 'players' | 'goalie'>> & { players?: string[]; goalie?: string };
export interface Case {
  q: string;
  want?: Want;
  alts?: Want[];
  /** the check must stop the search with an error matching this */
  error?: RegExp;
}

const SOG = ['goal', 'save'] as CheckedFilter['events'];
const ATT = ['goal', 'save', 'miss', 'block'] as CheckedFilter['events'];

export const CASES: Case[] = [
  { q: 'HPK power play shots in the third', want: { events: SOG, side: 'home', strength: ['PP'], periods: [3] } },
  { q: 'Every goal #94 was involved in', want: { events: ['goal'], players: ['Hakulinen'], playerRole: 'any' } },
  {
    q: 'Dangerous Ässät chances while they were trailing',
    want: { events: ATT, side: 'away', minXg: 0.15, scoreState: 'trailing' },
    alts: [{ events: SOG, side: 'away', minXg: 0.15, scoreState: 'trailing' }],
  },
  { q: 'Saves by Saarinen in the last five minutes of the 3rd', want: { events: ['save'], goalie: 'Saarinen', periods: [3], from: 900, to: 1200 } },
  { q: 'Ässät:n maalit kuudella viittä vastaan', want: { events: ['goal'], side: 'away', goaliePulled: true } },
  { q: 'Alle Tore in der Verlängerung', want: { events: ['goal'], periods: [4] } },
  { q: 'Skott av HPK i tredje perioden', want: { events: SOG, side: 'home', periods: [3] } },
  { q: 'Schüsse von Pinard im zweiten Drittel', want: { events: SOG, players: ['Pinard'], periods: [2] } },
  { q: 'HPK:n ylivoimamaalit', want: { events: ['goal'], side: 'home', strength: ['PP'] } },
  { q: 'HPK penalties in the third period', want: { events: ['penalty'], side: 'home', periods: [3] } },
  { q: 'Blocked shots by Määttä', want: { events: ['block'], players: ['Määttä'], playerRole: 'blocker' } },
  { q: 'How many shots did Kukkonen take?', want: { events: SOG, players: ['Kukkonen'] }, alts: [{ events: ATT, players: ['Kukkonen'] }] },
  { q: 'Shot attempts by HPK in the first 10 minutes of the game', want: { events: ATT, side: 'home', periods: [1], from: 0, to: 600 } },
  { q: 'Ässät goals on the power play', want: { events: ['goal'], side: 'away', strength: ['PP'] } },
  { q: 'Shorthanded shots', want: { events: SOG, strength: ['SH'] }, alts: [{ events: ATT, strength: ['SH'] }] },
  {
    q: 'Shots on Taponen when the score was tied',
    want: { events: SOG, goalie: 'Taponen', scoreState: 'tied' },
    alts: [{ events: SOG, goalie: 'Taponen', scoreState: 'tied', side: 'home' }],
  },
  { q: "Kostilainen's points", want: { events: ['goal'], players: ['Kostilainen'], playerRole: 'any' } },
  { q: 'Goals assisted by Päivärinta', want: { events: ['goal'], players: ['Päivärinta'], playerRole: 'assist' } },
  { q: 'Shots with an xG over 0.3', want: { events: SOG, minXg: 0.3 }, alts: [{ events: ATT, minXg: 0.3 }] },
  { q: 'Goals in the last minute of regulation', want: { events: ['goal'], periods: [3], from: 1140, to: 1200 } },
  {
    q: 'Shots by Hakulinen while HPK was leading',
    want: { events: SOG, players: ['Hakulinen'], side: 'home', scoreState: 'leading' },
    alts: [{ events: SOG, players: ['Hakulinen'], scoreState: 'leading' }],
  },
  // the check has to stop these
  { q: 'Shots by #8', error: /matches 2 players/ },
  { q: 'Hits by Hakulinnen', error: /hit/i },
  { q: 'Goals by Mäkinen', error: /didn't play/ },
  { q: 'Goals in the 5th period', error: /shootout/ },
  { q: 'Tappara goals in the second', error: /didn't play/ },
  { q: 'Every 2-on-1 rush in the second period', error: /rush/ },
  { q: 'Faceoffs won by Korhonen', error: /faceoff/i },
];
