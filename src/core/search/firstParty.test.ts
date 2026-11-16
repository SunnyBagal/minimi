import { describe, expect, it } from 'vitest';
import { isFirstParty } from './firstParty';

describe('isFirstParty', () => {
  it('matches the entity domain', () => {
    expect(isFirstParty('https://www.basaltdb.test/pricing', 'Basalt DB')).toBe(true);
  });

  it('rejects a different domain that mentions the entity', () => {
    expect(isFirstParty('https://blog.example.com/basalt-db-review', 'Basalt DB')).toBe(false);
  });

  it('handles a second-level public suffix', () => {
    expect(isFirstParty('https://northwindpg.co.uk/pricing', 'Northwind PG')).toBe(true);
  });

  it('matches on the entity first word of 4+ letters', () => {
    expect(isFirstParty('https://basalt.io/pricing', 'Basalt DB')).toBe(true);
  });

  it('does not match a first word shorter than 4 letters', () => {
    expect(isFirstParty('https://acme.com/pricing', 'Acm Corp')).toBe(false);
  });

  it('matches subdomains of the entity domain', () => {
    expect(isFirstParty('https://docs.basaltdb.test/intro', 'Basalt DB')).toBe(true);
  });

  it('handles .com.au', () => {
    expect(isFirstParty('https://acme.com.au/plans', 'Acme')).toBe(true);
  });

  it('rejects look-alike domains', () => {
    expect(isFirstParty('https://basaltdbreviews.com/pricing', 'Basalt DB')).toBe(false);
  });

  it('is false for an invalid URL', () => {
    expect(isFirstParty('not a url', 'Basalt DB')).toBe(false);
  });

  it('is false for an empty entity', () => {
    expect(isFirstParty('https://basaltdb.test/pricing', '')).toBe(false);
  });
});
