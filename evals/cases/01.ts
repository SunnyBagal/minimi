import { candidateDates, chosenIs, numbersAllowed, ok, verdictFor, verdictIs, verdictsOf } from '../assert';
import { CRM_NAMES, MSG_CASE_1 } from '../messages';
import { scenarioCrmChanged } from '../scenarios';
import { CLOCK, TZ, type EvalCase } from '../types';

const TRIED = /not found|could not|couldn't|unavailable|404|no result|timed out|nothing/i;

export const evalCase: EvalCase = {
  id: 1,
  parts: [{ seeds: ['S-CRM'], clock: CLOCK, tz: TZ, scenario: scenarioCrmChanged(), messages: [MSG_CASE_1] }],
  check(run) {
    const events = run.parts[0]?.traces[0]?.events ?? [];
    const answer = run.parts[0]?.traces[0]?.answerText ?? '';
    const rows = verdictsOf(events);
    const names = rows.map((row) => row.claim.entity);
    const salesyard = verdictFor(events, 'Salesyard', 'price');
    const salesyardOk =
      salesyard?.check.verdict === 'source_unavailable' || salesyard?.check.verdict === 'unverifiable';
    const sinceMonday =
      /leadharbor[\s\S]{0,160}(2 nov|2 november)[\s\S]{0,80}since monday/i.test(answer) ||
      /since monday[\s\S]{0,160}leadharbor[\s\S]{0,80}(2 nov|2 november)/i.test(answer);
    const nothingNew = /nothing new/i.test(answer);
    const namedPlace = /changelog|looked|checked|\.test/i.test(answer);
    const liveRows = rows.filter(
      (row) => row.check.verdict === 'changed' || row.check.verdict === 'unchanged',
    );
    return [
      chosenIs(events, '2026-11-09'),
      candidateDates(events, ['2026-11-09']),
      ok(
        'exactly the five stored names get a row',
        names.length === CRM_NAMES.length && CRM_NAMES.every((name) => names.includes(name)),
        names,
      ),
      verdictIs(events, 'Dealbase', 'price', 'changed'),
      verdictIs(events, 'Pipeloom', 'price', 'unchanged'),
      ok('Salesyard is source_unavailable or unverifiable', salesyardOk, salesyard?.check.verdict ?? null),
      ok('answer says what was tried for Salesyard', answer.includes('Salesyard') && TRIED.test(answer), answer),
      ok('11 Nov Closewise post is reported with its date', /11 Nov/.test(answer) && answer.includes('Closewise'), answer),
      ok('2 Nov Leadharbor post is not reported as since Monday', !sinceMonday, sinceMonday),
      ok(
        'a nothing-new statement names where it looked',
        !nothingNew || namedPlace,
        nothingNew ? 'nothing new' : 'no nothing-new statement',
      ),
      ok(
        'every changed or unchanged row has a live url',
        liveRows.every((row) => row.nowSource !== null && row.nowSource.live && row.nowSource.url.length > 0),
        liveRows.map((row) => ({ entity: row.claim.entity, url: row.nowSource?.url ?? null, live: row.nowSource?.live ?? null })),
      ),
      numbersAllowed(run, events, []),
    ];
  },
};
