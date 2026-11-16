import { describe, expect, it } from 'vitest';
import gameJson from '../src/data/game.json';
import { applyPatch, checkDraft } from '../src/shared/check.ts';
import { EXAMPLE_NAMES } from '../src/shared/prompt.ts';
import { runQuery } from '../src/shared/query.ts';
import type { Game } from '../src/shared/types.ts';

const game = gameJson as unknown as Game;
const id = (last: string) => game.players.find((p) => p.last === last)!.id;
const errors = (r: ReturnType<typeof checkDraft>) => r.checks.filter((c) => c.level === 'error');

describe('the data build', () => {
  it('has every goal of the final score', () => {
    const goals = game.events.filter((e) => e.type === 'goal');
    expect(goals.filter((e) => e.side === 'home')).toHaveLength(game.teams.home.goals);
    expect(goals.filter((e) => e.side === 'away')).toHaveLength(game.teams.away.goals);
  });
  it('labels the 5-on-3 power-play goal and the 6-on-5 tying goal', () => {
    const doucet = game.events.find((e) => e.type === 'goal' && e.player === id('Doucet'))!;
    expect(doucet.strength).toBe('PP');
    expect(doucet.manpower).toBe('5v3');
    const tying = game.events.find((e) => e.type === 'goal' && e.tags?.includes('Extra attacker'))!;
    expect(tying.extraAttacker).toBe(true);
    expect(tying.manpower).toBe('6v5');
    expect(tying.scoreState).toBe('trailing');
  });
  it('rotates shots so the home team attacks right', () => {
    const shots = game.events.filter((e) => e.x !== undefined);
    const mean = (side: string) => {
      const xs = shots.filter((e) => e.side === side).map((e) => e.x!);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(mean('home')).toBeGreaterThan(650);
    expect(mean('away')).toBeLessThan(350);
  });
  it('keeps the prompt examples free of real names', () => {
    for (const n of EXAMPLE_NAMES) expect(game.players.some((p) => p.last === n)).toBe(false);
  });
});

describe('checkDraft', () => {
  it('passes a clean draft and runs it', () => {
    const r = checkDraft('{"events":["shots"],"team":"HPK","strength":["PP"],"periods":[3]}', game);
    expect(r.ok).toBe(true);
    expect(r.filter).toMatchObject({ events: ['goal', 'save'], side: 'home', strength: ['PP'], periods: [3] });
    for (const e of runQuery(r.filter, game)) expect(e).toMatchObject({ side: 'home', strength: 'PP', period: 3 });
  });

  it('reads JSON wrapped in a code fence', () => {
    expect(checkDraft('```json\n{"team":"Ässät"}\n```', game).ok).toBe(true);
  });

  it('rejects broken JSON', () => {
    const r = checkDraft('{"team": "HPK"', game);
    expect(r.ok).toBe(false);
    expect(r.checks[0].field).toBe('json');
  });

  it('matches names without accents', () => {
    const r = checkDraft({ players: ['Paivarinta'] }, game);
    expect(r.ok).toBe(true);
    expect(r.filter.players).toEqual([id('Päivärinta')]);
  });

  it('fixes a one-letter typo, and says so', () => {
    const r = checkDraft({ players: ['Hakulinnen'] }, game);
    expect(r.ok).toBe(true);
    expect(r.filter.players).toEqual([id('Hakulinen')]);
    expect(r.checks.find((c) => c.field === 'players')!.level).toBe('fixed');
  });

  it('asks which player when a number is on both teams', () => {
    const r = checkDraft({ players: ['#8'] }, game);
    expect(r.ok).toBe(false);
    const [err] = errors(r);
    expect(err.suggestions).toHaveLength(2);
    const fixed = checkDraft(applyPatch(r.draft, err.suggestions![0].patch), game);
    expect(fixed.ok).toBe(true);
    expect(fixed.filter.players).toHaveLength(1);
  });

  it('uses the team filter to pick the right #8', () => {
    const r = checkDraft({ players: ['#8'], team: 'Ässät' }, game);
    expect(r.ok).toBe(true);
    expect(r.filter.players).toEqual([id('Olofsson')]);
  });

  it('knows a player who is on the roster but did not dress', () => {
    const r = checkDraft({ players: ['Mäkinen'] }, game);
    expect(r.ok).toBe(false);
    expect(errors(r)[0].message).toMatch(/didn't play/);
  });

  it('rejects a player from another game with suggestions only when close', () => {
    const r = checkDraft({ players: ['Barkov'] }, game);
    expect(r.ok).toBe(false);
    expect(errors(r)[0].message).toMatch(/No player called/);
  });

  it('refuses event types the feed does not have, instead of returning zero', () => {
    const r = checkDraft({ events: ['hits'], players: ['#94'] }, game);
    expect(r.ok).toBe(false);
    expect(errors(r)[0].message).toMatch(/no hit events/);
  });

  it('blocks on anything the model flagged as unsupported', () => {
    const r = checkDraft({ events: ['shots'], unsupported: ['2-on-1 rushes'] }, game);
    expect(r.ok).toBe(false);
    expect(errors(r)[0].message).toMatch(/rush/);
    expect(checkDraft(applyPatch(r.draft, errors(r)[0].suggestions![0].patch), game).ok).toBe(true);
  });

  it('blocks on keys the model invented', () => {
    const r = checkDraft({ events: ['shots'], shotType: 'slapshot' }, game);
    expect(r.ok).toBe(false);
    expect(checkDraft(r.draft, game).ok).toBe(true);
  });

  it('knows there was no shootout', () => {
    const r = checkDraft({ events: ['goal'], periods: [5] }, game);
    expect(r.ok).toBe(false);
    expect(errors(r)[0].message).toMatch(/no shootout/);
  });

  it('rejects a time window that runs backwards or past the period', () => {
    expect(checkDraft({ from: '18:00', to: '12:00' }, game).ok).toBe(false);
    expect(checkDraft({ periods: [4], from: '00:00', to: '10:00' }, game).ok).toBe(false);
  });

  it('catches a team that cannot shoot at its own goalie', () => {
    const r = checkDraft({ team: 'HPK', goalie: 'Saarinen' }, game);
    expect(r.ok).toBe(false);
    expect(errors(r)[0].message).toMatch(/own goalie/);
  });

  it('catches a skater passed as the goalie', () => {
    const r = checkDraft({ goalie: 'Hakulinen' }, game);
    expect(r.ok).toBe(false);
    expect(errors(r)[0].message).toMatch(/not a goalie/);
  });

  it('catches a player on the wrong team', () => {
    expect(checkDraft({ team: 'HPK', players: ['Pinard'] }, game).ok).toBe(false);
    // ...but a blocker is on the other team by definition
    expect(checkDraft({ team: 'HPK', players: ['Määttä'], playerRole: 'blocker' }, game).ok).toBe(true);
  });

  it('reads xG given as a percentage', () => {
    const r = checkDraft({ minXg: 20 }, game);
    expect(r.ok).toBe(true);
    expect(r.filter.minXg).toBeCloseTo(0.2);
    expect(r.filter.events).not.toContain('penalty');
  });

  it('finds the overtime winner', () => {
    const r = checkDraft({ events: ['goal'], periods: ['OT'] }, game);
    const hits = runQuery(r.filter, game);
    expect(hits).toHaveLength(1);
    expect(hits[0].tags).toContain('Game winner');
  });
});
