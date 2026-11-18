import { allClaims, chosenIs, intentIs, numbersAllowed, ok, verdictFor, verdictsOf } from '../assert';
import { MSG_CASE_3, MSG_STILL } from '../messages';
import { scenarioPgChanged } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

export const evalCase: EvalCase = {
  id: 19,
  parts: [
    {
      seeds: ['S-PG', 'S-NOV3'],
      clock: CLOCK,
      tz: TZ,
      scenario: scenarioPgChanged(),
      messages: [MSG_CASE_3, MSG_STILL, MSG_CASE_3],
    },
  ],
  check(run) {
    const again = run.parts[0]?.traces[1];
    const repeat = run.parts[0]?.traces[2];
    const againEvents = again?.events ?? [];
    const repeatEvents = repeat?.events ?? [];
    const againRows = verdictsOf(againEvents);
    const againNorth = verdictFor(againEvents, 'Northwind PG', 'price');
    const repeatNorth = verdictFor(repeatEvents, 'Northwind PG', 'price');
    const noRecord = /nothing about|no record|don't have a record|do not have a record/i.test(again?.answerText ?? '');
    const seeds = run.store.findTurns({
      dates: ['2026-11-10'],
      topic: 'Postgres hosting',
      excludeTurnIds: [],
      limit: 5,
    });
    const original = seeds.find((hit) => hit.userTurn.origin === 'seed')?.assistantTurn;
    const stated = original == null ? [] : run.store.claimsForTurns([original.id], 'as_stated');
    const originalNorth = stated.find((claim) => claim.entity === 'Northwind PG' && claim.attribute === 'price');
    const current = original == null ? [] : run.store.claimsForTurns([original.id], 'current');
    const currentNorth = current.find((claim) => claim.entity === 'Northwind PG' && claim.attribute === 'price');
    const replacements =
      originalNorth === undefined ? [] : allClaims(run.store).filter((claim) => claim.supersedesId === originalNorth.id);
    const oneSupersede =
      originalNorth !== undefined &&
      currentNorth !== undefined &&
      currentNorth.id !== originalNorth.id &&
      currentNorth.supersedesId === originalNorth.id &&
      replacements.length === 1;
    return [
      intentIs(againEvents, 'recheck'),
      ok('turn A has three verdict rows', againRows.length === 3, againRows.length),
      ok(
        'turn A rows are the S-PG claims',
        ['Northwind PG price', 'Basalt DB price', 'Basalt DB free tier'].every((key) =>
          againRows.some((row) => `${row.claim.entity} ${row.claim.attribute}` === key),
        ),
        againRows.map((row) => `${row.claim.entity} ${row.claim.attribute}`),
      ),
      ok(
        'turn A Northwind claim.value contains 24',
        (againNorth?.claim.value ?? '').includes('24'),
        againNorth?.claim.value ?? null,
      ),
      ok('turn A Northwind verdict is unchanged', againNorth?.check.verdict === 'unchanged', againNorth?.check.verdict ?? null),
      ok('turn A is not a no-record answer', !noRecord, again?.answerText ?? ''),
      chosenIs(repeatEvents, '2026-11-10'),
      ok(
        'turn B Northwind claim.value contains 19',
        (repeatNorth?.claim.value ?? '').includes('19'),
        repeatNorth?.claim.value ?? null,
      ),
      ok('turn B Northwind verdict is changed', repeatNorth?.check.verdict === 'changed', repeatNorth?.check.verdict ?? null),
      ok('turn B newValue contains 24', (repeatNorth?.check.newValue ?? '').includes('24'), repeatNorth?.check.newValue ?? null),
      ok('exactly one claim supersedes the original Northwind claim', oneSupersede, currentNorth?.supersedesId ?? null),
      numbersAllowed(run, run.parts[0]?.traces[0]?.events ?? [], [], 'first turn'),
      numbersAllowed(run, againEvents, [], 'turn A'),
      numbersAllowed(run, repeatEvents, [], 'turn B'),
    ];
  },
};
