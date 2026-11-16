/**
 * Stand-ins wired into the live app until Lane 1 merges. Lane 1 replaces the
 * two entry modules that re-export these and then deletes this file.
 * Both fail safe: no date is ever resolved, and no verdict is ever confirmed.
 */
import type { GuardVerdict, TimeFns } from '../contracts';
import { intlFormatLocal, intlToLocalDate } from './fakes';

export const placeholderTime: TimeFns = {
  resolveTimeRef: () => ({ dates: [], range: null, ambiguous: false, rule: 'placeholder: Lane 1 not merged' }),
  toLocalDate: intlToLocalDate,
  formatLocal: intlFormatLocal,
};

/** Never returns `changed` or `unchanged`, whatever the judge said. */
export const placeholderGuard: GuardVerdict = () => ({
  verdict: 'unverifiable',
  newValue: null,
  newQuote: null,
  reason: 'Verdict guards are not merged yet.',
  decidedBy: 'guard',
});
