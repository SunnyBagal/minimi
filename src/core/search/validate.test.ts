import { describe, expect, it } from 'vitest';
import type { SourceRef } from '../contracts';
import { validateAnswer } from './validate';

const NOW = '2026-11-10T20:00:00.000Z';

const evidence: SourceRef[] = [1, 2, 3].map((n) => ({
  n,
  sourceId: `source-${n}`,
  url: `https://example.com/${n}`,
  title: null,
  fetchedAtUtc: NOW,
  live: true,
  firstParty: false,
  text: '',
}));

describe('strippedCitations', () => {
  it('[7] with three evidence items', () => {
    expect(validateAnswer('The price is 24 USD [7].', evidence, []).strippedCitations).toEqual([7]);
  });

  it('dedupes and sorts ascending', () => {
    expect(validateAnswer('A [9] B [7] C [9].', evidence, []).strippedCitations).toEqual([7, 9]);
  });

  it('keeps valid citations out of stripped', () => {
    expect(validateAnswer('A [1] B [2] C [3].', evidence, []).strippedCitations).toEqual([]);
  });
});

describe('uncitedNumbers', () => {
  it('uncited 24 in a sentence with no citation', () => {
    expect(validateAnswer('The plan costs 24 USD.', evidence, []).uncitedNumbers).toEqual(['24']);
  });

  it('returns nothing when the number is in allowedNumbers', () => {
    expect(validateAnswer('The plan costs 24 USD.', evidence, ['24']).uncitedNumbers).toEqual([]);
  });

  it('sentence ends with [1] — cited', () => {
    expect(validateAnswer('The plan costs 24 USD [1].', evidence, []).uncitedNumbers).toEqual([]);
    expect(validateAnswer('The plan costs 24 USD. [1]', evidence, []).uncitedNumbers).toEqual([]);
  });

  it('a [1] in the NEXT sentence does not cite', () => {
    const result = validateAnswer('It costs 24 USD. See [1] for details.', evidence, []);
    expect(result.uncitedNumbers).toEqual(['24']);
  });

  it('ignores list markers at line start', () => {
    const text = '1. First item costs 30 USD\n2) Second item';
    expect(validateAnswer(text, evidence, []).uncitedNumbers).toEqual(['30']);
  });

  it('keeps currency, separators and percent as written', () => {
    const result = validateAnswer('Now $24.50, was 1,200 users, up 15%.', evidence, []);
    expect(result.uncitedNumbers).toEqual(['$24.50', '1,200', '15%']);
  });

  it.each([
    '### **100% completion**',
    'Try the **100% COMPLETE** objective.',
    '100% completionist',
    '100%-ing',
    '100%ing',
    'a 100% run',
    '100% playthrough',
  ])('ignores the fixed completion term in %s', (text) => {
    expect(validateAnswer(text, evidence, []).uncitedNumbers).toEqual([]);
  });

  it.each([
    ['100% uptime', ['100%']],
    ['reached 100% of users', ['100%']],
    ['a 100% increase', ['100%']],
    ['100 hours', ['100']],
    ['50 to 70 hours', ['50', '70']],
    ['a 100% completion rate', ['100%']],
    ['a 100% run rate', ['100%']],
    ['1,100% completion', ['1,100%']],
  ])('still flags unsupported figures in %s', (text, expected) => {
    expect(validateAnswer(text, evidence, []).uncitedNumbers).toEqual(expected);
  });

  it('trims a trailing sentence period from the token', () => {
    const result = validateAnswer('The price is 24. And more.', evidence, []);
    expect(result.uncitedNumbers).toEqual(['24']);
  });

  it('never reports citation digits', () => {
    const result = validateAnswer('Price is 24 USD [7].', evidence, []);
    expect(result.uncitedNumbers).toEqual(['24']);
  });

  it('H100 is not a number token', () => {
    expect(validateAnswer('The H100 plan is great.', evidence, []).uncitedNumbers).toEqual([]);
  });

  it('an invalid citation does not cite', () => {
    const result = validateAnswer('The plan costs 24 USD [7].', evidence, []);
    expect(result.uncitedNumbers).toEqual(['24']);
    expect(result.strippedCitations).toEqual([7]);
  });
});
