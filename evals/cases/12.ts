import { numbersAllowed, ok, sentencesOf } from '../assert';
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
    // Per vendor: a stored claim plus a sentence naming it with a USD figure and a citation, or a sentence saying it could not be verified.
    const sentences = sentencesOf(answer);
    const evidence = new Set(
      events.flatMap((event) => (event.type === 'citations' ? event.items.map((item) => item.n) : [])),
    );
    const covered = CRM_NAMES.filter((name) => {
      // Sentences about this vendor only (naming no other fixture vendor).
      const own = sentences.filter((sentence) => sentence.includes(name) && CRM_NAMES.every((other) => other === name || !sentence.includes(other)));
      const vendorClaims = claims.filter((claim) => claim.entity === name);
      const amounts = vendorClaims.flatMap((claim) => claim.value.match(/\d+(?:\.\d+)?/g) ?? []);
      const citedOwnPrice = own.some(
        (sentence) =>
          amounts.some((amount) => new RegExp(`\\b${amount.replace('.', '\\.')}\\b`).test(sentence)) &&
          [...sentence.matchAll(/\[(\d+)\]/g)].some((match) => evidence.has(Number(match[1]))),
      );
      const couldNot = own.some((sentence) => /couldn'?t (verify|find|confirm)|could not (verify|find|confirm)|no (price|pricing)|doesn'?t (say|list)|does not (say|list)/i.test(sentence));
      return citedOwnPrice || couldNot;
    });
    const anyCited = CRM_NAMES.some((name) => claims.some((claim) => claim.entity === name));
    return [
      ok('5 searches at most', searches.length <= 5, searches.length),
      ok('each named tool is cited or marked could not verify', covered.length === CRM_NAMES.length, covered),
      ok(
        'verified claims were written by a live turn',
        (claims.length > 0 || !anyCited) && claims.every(() => assistant?.origin === 'live'),
        assistant?.origin ?? null,
      ),
      numbersAllowed(run, events, servedPageTexts(scenario, trace?.log ?? [])),
      numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], [], 'first turn'),
    ];
  },
};
