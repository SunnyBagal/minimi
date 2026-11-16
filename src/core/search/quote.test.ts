import { describe, expect, it } from 'vitest';
import { containsQuote, MIN_QUOTE_CHARS, normalizeForQuote } from './quote';

const PAGE =
  '## Pricing\n\nThe **Basic** plan costs “$24 USD” — billed monthly.\n\n> Taxes not included.';

describe('MIN_QUOTE_CHARS', () => {
  it('is 12', () => {
    expect(MIN_QUOTE_CHARS).toBe(12);
  });
});

describe('normalizeForQuote', () => {
  it('normalizes NFKC, quotes, dashes, case and whitespace', () => {
    expect(normalizeForQuote('  “Plan” — WÖRLD   ')).toBe('"plan" - wörld');
    expect(normalizeForQuote('it’s ‘fine’')).toBe("it's 'fine'");
  });

  it('converts non-breaking and zero-width spaces to plain spaces', () => {
    expect(normalizeForQuote('a b c d')).toBe('a b c d');
    expect(normalizeForQuote('x​y‌z')).toBe('x y z');
  });

  it('strips markdown emphasis and line marks', () => {
    expect(normalizeForQuote('## Title\n> quoted **bold** _it_ `code`')).toBe(
      'title quoted bold it code',
    );
  });
});

describe('containsQuote', () => {
  it('is true across markdown marks, curly quotes and dashes', () => {
    expect(containsQuote(PAGE, 'the Basic plan costs "$24 USD" - billed monthly.')).toBe(true);
  });

  it('is true across whitespace differences including newlines and NBSP', () => {
    expect(containsQuote(PAGE, 'taxes   not\nincluded.')).toBe(true);
    expect(containsQuote(PAGE, 'Taxes not included.')).toBe(true);
  });

  it('is true across case differences', () => {
    expect(containsQuote(PAGE, 'THE BASIC PLAN COSTS')).toBe(true);
  });

  it('is false for a quote shorter than MIN_QUOTE_CHARS even when present', () => {
    expect(containsQuote(PAGE, 'Taxes')).toBe(false);
    expect(containsQuote(PAGE, 'not includ')).toBe(false);
  });

  it('is false for an absent quote', () => {
    expect(containsQuote(PAGE, 'the enterprise plan costs')).toBe(false);
  });
});
