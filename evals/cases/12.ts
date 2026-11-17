import { numbersAllowed, ok } from '../assert';
import { servedPageTexts } from '../fixtureSearch';
import { CRM_NAMES, MSG_CASE_1, MSG_NAMES } from '../messages';
import { scenarioCrmFresh } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

const scenario = scenarioCrmFresh();

export const evalCase: EvalCase = {
  id: 12,
  parts: [
    { seeds: [], clock: CLOCK, tz: TZ, scenario, messages: [MSG_CASE_1, MSG_NAMES] },
  ],
  check(run) {
    const trace = run.parts[0]?.traces[1];
    const events = trace?.events ?? [];
    const answer = trace?.answerText ?? '';
    const searches = (trace?.log ?? []).filter((call) => call.kind === 'search');
    const done = events.find((event) => event.type === 'done');
    const turnId = done?.type === 'done' ? done.turnId : '';
    const claims = run.store.claimsForTurns(turnId === '' ? [] : [turnId], 'as_stated');
    const assistant = turnId === '' ? undefined : run.store.getTurns([turnId])[0];
    const covered = CRM_NAMES.filter((name) => {
      const hasClaim = claims.some((claim) => claim.entity === name);
      const couldNot = new RegExp(`${name}[\\s\\S]{0,80}couldn'?t verify|could not verify[\\s\\S]{0,80}${name}`, 'i');
      const cited = answer.includes(name) && (/\[[0-9]+\]/.test(answer) || /USD/.test(answer) || couldNot.test(answer));
      return hasClaim || cited || couldNot.test(answer);
    });
    return [
      ok('5 searches at most', searches.length <= 5, searches.length),
      ok('each named tool is cited or marked could not verify', covered.length === CRM_NAMES.length, covered),
      ok(
        'verified claims were written by a live turn',
        claims.every(() => assistant?.origin === 'live'),
        assistant?.origin ?? null,
      ),
      numbersAllowed(run, events, servedPageTexts(scenario, trace?.log ?? [])),
    ];
  },
};
