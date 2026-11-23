import { describe, expect, it } from 'vitest';
import { acronyms, matchTerms, terms } from './matchTerms';

describe('matchTerms', () => {
  it('keeps the word rule: three letters or more, lowercased', () => {
    expect(terms('GTA 6 on 19 Nov, Pro plan')).toEqual(['gta', 'nov', 'pro', 'plan']);
  });

  it('adds the initials of a run of three or more capitalised words', () => {
    expect(acronyms('Grand Theft Auto VI')).toEqual(expect.arrayContaining(['gta', 'gtav', 'tav']));
    expect(acronyms('What did I ask about Grand Theft Auto on Thursday?')).toContain('gta');
  });

  it('adds nothing for runs shorter than three words or for lowercase text', () => {
    expect(acronyms('Supabase Pro')).toEqual([]);
    expect(acronyms('grand theft auto')).toEqual([]);
    expect(acronyms('GTA 6')).toEqual([]);
  });

  it('lets a full name and its acronym meet in either direction', () => {
    const asked = new Set(matchTerms('Grand Theft Auto VI'));
    const stored = new Set(matchTerms('How long will it take to finish GTA 6?'));
    expect([...asked].some((term) => stored.has(term))).toBe(true);
    const askedShort = new Set(matchTerms('GTA 6'));
    const storedLong = new Set(matchTerms('Grand Theft Auto VI playtime'));
    expect([...askedShort].some((term) => storedLong.has(term))).toBe(true);
  });
});
