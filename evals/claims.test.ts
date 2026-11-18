import { describe, expect, it } from 'vitest';
import { claimsNoChangeAbout, sentencesOf } from './assert';

// The case 16 run-1 answer from evals/results/2026-11-18T15-13-43.417Z.json.
const CASE_16_RUN_1 =
  "Basalt DB is unchanged since your earlier question. Its price is still 25 USD/month and its free tier is still 1 project, and both are still quoted on the live first-party page. I couldn't check Northwind PG: the page took too long to load and the request timed out, so I can't say whether the earlier price of 19 USD/month still holds.";

describe('claimsNoChangeAbout', () => {
  it('does not count "unchanged" about another entity (the case 16 run-1 answer)', () => {
    expect(claimsNoChangeAbout(CASE_16_RUN_1, /northwind/i)).toBe(false);
    expect(claimsNoChangeAbout(CASE_16_RUN_1, /basalt/i)).toBe(true);
  });

  it('counts a sentence that says nothing changed for the entity', () => {
    expect(claimsNoChangeAbout('Northwind PG is unchanged at 19 USD/month.', /northwind/i)).toBe(true);
    expect(claimsNoChangeAbout('There is no change for Northwind PG.', /northwind/i)).toBe(true);
    expect(claimsNoChangeAbout('Nothing has changed for Northwind PG.', /northwind/i)).toBe(true);
    expect(claimsNoChangeAbout('Northwind PG still holds at 19 USD.', /northwind/i)).toBe(true);
  });

  it('does not count a sentence that says the change could not be confirmed', () => {
    expect(claimsNoChangeAbout("I can't confirm Northwind PG is unchanged.", /northwind/i)).toBe(false);
    expect(claimsNoChangeAbout('Northwind PG could not be checked, so whether it is unchanged is unknown.', /northwind/i)).toBe(false);
  });

  it('splits sentences at terminators and line breaks', () => {
    expect(sentencesOf('A is fine. B is not!\nC? D')).toEqual(['A is fine.', 'B is not!', 'C?', 'D']);
  });
});

describe('claimsNoChangeAbout: subject and uncertainty scoped to the clause', () => {
  it('counts a Northwind no-change claim next to doubt about another product', () => {
    expect(claimsNoChangeAbout("I couldn't check Basalt DB, but Northwind PG is unchanged.", /northwind/i, /basalt/i)).toBe(true);
    expect(claimsNoChangeAbout('Northwind PG is unchanged; whether Basalt DB changed is unclear.', /northwind/i, /basalt/i)).toBe(true);
  });

  it('follows "Its" back to the product named just before', () => {
    expect(claimsNoChangeAbout('Northwind PG could not be reached. Its price is unchanged.', /northwind/i, /basalt/i)).toBe(true);
    expect(claimsNoChangeAbout('Basalt DB was checked. Its price is unchanged.', /northwind/i, /basalt/i)).toBe(false);
  });

  it('still passes the saved case 16 run-1 answer with Basalt as the other product', () => {
    expect(claimsNoChangeAbout(CASE_16_RUN_1, /northwind/i, /basalt/i)).toBe(false);
  });

  it('does not carry the subject into a clause that does not refer back', () => {
    expect(claimsNoChangeAbout('Northwind PG timed out. Everything else is unchanged.', /northwind/i, /basalt/i)).toBe(false);
  });
});

describe('claimsNoChangeAbout: the phrase belongs to the product named before it', () => {
  it('does not give a no-change phrase about Basalt to Northwind named later in the clause', () => {
    expect(claimsNoChangeAbout('Basalt DB is unchanged and Northwind PG timed out.', /northwind/i, /basalt/i)).toBe(false);
  });

  it('counts coordinated subjects: "Northwind PG and Basalt DB are unchanged"', () => {
    expect(claimsNoChangeAbout('Northwind PG and Basalt DB are unchanged.', /northwind/i, /basalt/i)).toBe(true);
  });

  it('carries the subject across a sentence that names no product', () => {
    expect(
      claimsNoChangeAbout('Northwind PG timed out. The source was unavailable. Its price is unchanged.', /northwind/i, /basalt/i),
    ).toBe(true);
  });
});

describe('claimsNoChangeAbout: every phrase, names on either side', () => {
  it('finds a second no-change phrase in the same clause', () => {
    expect(claimsNoChangeAbout('Basalt DB is unchanged and Northwind PG is unchanged.', /northwind/i, /basalt/i)).toBe(true);
  });

  it('gives a phrase to every product coordinated after it', () => {
    expect(claimsNoChangeAbout('No change for Basalt DB and Northwind PG.', /northwind/i, /basalt/i)).toBe(true);
  });

  it('keeps the mixed sentence negative', () => {
    expect(claimsNoChangeAbout('Basalt DB is unchanged and Northwind PG timed out.', /northwind/i, /basalt/i)).toBe(false);
  });
});
