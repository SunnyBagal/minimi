/**
 * The verdict guard: applies the eight code rules to a judge output and
 * returns the fields of a Check. It can keep a verdict or downgrade it to
 * `unverifiable`/`source_unavailable`; only rule 7 turns `changed` into
 * `unchanged`. It never upgrades `unverifiable` or `source_unavailable`.
 *
 * Pure: the quote check arrives in the context, so this file imports types
 * only. One small function per row of the "Guard rules" table in the brief;
 * the first rule that fires decides.
 */
import type { GuardVerdict, JudgeOutput } from '../contracts';

type Context = Parameters<GuardVerdict>[1];
type Decision = ReturnType<GuardVerdict>;
type Rule = (output: JudgeOutput, context: Context) => Decision | null;

/** Number tokens like `24`, `1,200` or `$24.50` (currency symbol not included in the token). */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((match) => Number(match[0].replace(/,/g, '')));
}

function firstNumber(text: string): number | null {
  return numbersIn(text)[0] ?? null;
}

/** Lowercase and collapse whitespace runs, for comparing values with no number. */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Two values are the same when their first numbers are equal numerically.
 * When neither holds a number, they are the same when their text matches
 * after normalizeText. A value with a number never equals one without.
 */
function sameValue(a: string, b: string): boolean {
  const first = firstNumber(a);
  const second = firstNumber(b);
  if (first !== null && second !== null) return first === second;
  if (first === null && second === null) return normalizeText(a) === normalizeText(b);
  return false;
}

const DEFAULT_REASON = 'The judge did not give a reason.';

function reason(output: JudgeOutput): string {
  return output.reason.trim() === '' ? DEFAULT_REASON : output.reason;
}

function passThrough(output: JudgeOutput): Decision {
  return {
    verdict: output.verdict,
    newValue: output.verdict === 'unchanged' ? null : output.newValue,
    newQuote: output.quote,
    reason: reason(output),
    decidedBy: 'judge',
  };
}

// 1. `output.verdict` is `source_unavailable` or `unverifiable` → pass
//    through, `newValue` and `newQuote` null, `decidedBy: 'judge'`.
const ruleFailedVerdict: Rule = (output) =>
  output.verdict === 'source_unavailable' || output.verdict === 'unverifiable'
    ? { verdict: output.verdict, newValue: null, newQuote: null, reason: reason(output), decidedBy: 'judge' }
    : null;

// 2. `context.page` is null, or its `status` is not `ok` → `source_unavailable`.
const ruleNoUsablePage: Rule = (_output, context) => {
  if (context.page === null) {
    return { verdict: 'source_unavailable', newValue: null, newQuote: null, reason: 'No page was fetched for this claim.', decidedBy: 'guard' };
  }
  if (context.page.status !== 'ok') {
    return {
      verdict: 'source_unavailable',
      newValue: null,
      newQuote: null,
      reason: `The page could not be fetched (${context.page.status}).`,
      decidedBy: 'guard',
    };
  }
  return null;
};

// 3. `context.page.live` is false → `source_unavailable`, reason says the
//    page came from a cache.
const ruleNotLive: Rule = (_output, context) =>
  context.page !== null && context.page.live === false
    ? { verdict: 'source_unavailable', newValue: null, newQuote: null, reason: 'The page came from a cache, not a live fetch.', decidedBy: 'guard' }
    : null;

// 4. `output.quote` is null, or `containsQuote(page.text, quote)` is false →
//    `unverifiable`, reason says the quote is not on the fetched page.
const ruleQuoteNotOnPage: Rule = (output, context) => {
  const quote = output.quote;
  if (quote === null || quote.trim() === '') {
    return { verdict: 'unverifiable', newValue: null, newQuote: null, reason: 'The judge gave no quote to check on the page.', decidedBy: 'guard' };
  }
  if (context.page === null || !context.containsQuote(context.page.text, quote)) {
    return { verdict: 'unverifiable', newValue: null, newQuote: null, reason: 'The quote is not on the fetched page.', decidedBy: 'guard' };
  }
  return null;
};

// 5. `output.scope` and `claim.scope` both set `period`, `currency` or `unit`,
//    and one of them differs → `unverifiable`, reason names the field and
//    both values.
const ruleScopeMismatch: Rule = (output, context) => {
  for (const field of ['period', 'currency', 'unit'] as const) {
    const judged = output.scope[field];
    const claimed = context.claim.scope[field];
    if (judged !== undefined && claimed !== undefined && judged !== claimed) {
      return {
        verdict: 'unverifiable',
        newValue: null,
        newQuote: null,
        reason: `The judge read ${field} "${judged}" but the claim is about ${field} "${claimed}".`,
        decidedBy: 'guard',
      };
    }
  }
  return null;
};

// 6. `changed` and `newValue` is empty, or `newValue` holds a number that is
//    not inside `quote` → `unverifiable`.
const ruleNewValueNotInQuote: Rule = (output) => {
  if (output.verdict !== 'changed') return null;
  const newValue = output.newValue ?? '';
  if (newValue.trim() === '') {
    return { verdict: 'unverifiable', newValue: null, newQuote: null, reason: 'The judge said the value changed but gave no new value.', decidedBy: 'guard' };
  }
  const quoteNumbers = output.quote === null ? [] : numbersIn(output.quote);
  if (numbersIn(newValue).some((n) => !quoteNumbers.some((q) => q === n))) {
    return {
      verdict: 'unverifiable',
      newValue: null,
      newQuote: null,
      reason: `The new value "${newValue}" holds a number that is not inside the quote.`,
      decidedBy: 'guard',
    };
  }
  return null;
};

// 7. `changed`, and the first number in `newValue` equals the first number in
//    `claim.value` numerically (for values with no number: equal after
//    lowercasing and collapsing whitespace) → `unchanged`, `decidedBy: 'guard'`.
const ruleSameValue: Rule = (output, context) => {
  if (output.verdict !== 'changed' || output.newValue === null) return null;
  if (!sameValue(output.newValue, context.claim.value)) return null;
  return {
    verdict: 'unchanged',
    newValue: null,
    newQuote: output.quote,
    reason: `The new value is the same as the stated value (${context.claim.value}), so nothing changed.`,
    decidedBy: 'guard',
  };
};

// 8. Otherwise → the judge's verdict, `newValue` (null for `unchanged`),
//    `newQuote` = `quote`, `decidedBy: 'judge'`.
const rulePassThrough: Rule = (output) => passThrough(output);

const RULES: Rule[] = [
  ruleFailedVerdict,
  ruleNoUsablePage,
  ruleNotLive,
  ruleQuoteNotOnPage,
  ruleScopeMismatch,
  ruleNewValueNotInQuote,
  ruleSameValue,
  rulePassThrough,
];

export const guardVerdict: GuardVerdict = (output, context) => {
  for (const rule of RULES) {
    const decision = rule(output, context);
    if (decision !== null) return decision;
  }
  return passThrough(output);
};
