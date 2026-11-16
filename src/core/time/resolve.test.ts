import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DateCandidates, IanaTz, LocalDate, TimeRef } from '../contracts';
import { resolveTimeRef } from './resolve';
import { InvalidTimeZoneError } from './zone';

const KOLKATA: IanaTz = 'Asia/Kolkata';

/** 12:00 in Asia/Kolkata on the given local date. */
const noon = (local: LocalDate) => new Date(`${local}T06:30:00.000Z`);

function check(
  ref: TimeRef,
  now: Date,
  wantDates: LocalDate[],
  wantRange: { from: LocalDate; to: LocalDate } | null = null,
  tz: IanaTz = KOLKATA,
): DateCandidates {
  const got = resolveTimeRef(ref, now, tz);
  expect(got.dates).toEqual(wantDates);
  expect(got.range).toEqual(wantRange);
  expect(got.ambiguous).toBe(wantDates.length > 1);
  expect(got.rule.length).toBeGreaterThan(0);
  return got;
}

describe('acceptance table (zone Asia/Kolkata)', () => {
  it('Fri 13 Nov 2026 · weekday 2 last → 2026-11-10, 2026-11-03, ambiguous', () => {
    check({ kind: 'weekday', weekday: 2, modifier: 'last' }, noon('2026-11-13'), ['2026-11-10', '2026-11-03']);
  });
  it('Mon 16 Nov 2026 · weekday 2 last → 2026-11-10', () => {
    check({ kind: 'weekday', weekday: 2, modifier: 'last' }, noon('2026-11-16'), ['2026-11-10']);
  });
  it('Tue 17 Nov 2026 · weekday 2 last → 2026-11-10', () => {
    check({ kind: 'weekday', weekday: 2, modifier: 'last' }, noon('2026-11-17'), ['2026-11-10']);
  });
  it('Wed 18 Nov 2026 · weekday 2 last → 2026-11-17, 2026-11-10, ambiguous', () => {
    check({ kind: 'weekday', weekday: 2, modifier: 'last' }, noon('2026-11-18'), ['2026-11-17', '2026-11-10']);
  });
  it('Fri 13 Nov 2026 · weekday 1 bare → 2026-11-09', () => {
    check({ kind: 'weekday', weekday: 1, modifier: 'bare' }, noon('2026-11-13'), ['2026-11-09']);
  });
  it('Mon 16 Nov 2026 · weekday 1 bare → 2026-11-16, 2026-11-09, ambiguous', () => {
    check({ kind: 'weekday', weekday: 1, modifier: 'bare' }, noon('2026-11-16'), ['2026-11-16', '2026-11-09']);
  });
  it('Tue 17 Nov 2026 · weekday 1 last → 2026-11-16, 2026-11-09, ambiguous', () => {
    check({ kind: 'weekday', weekday: 1, modifier: 'last' }, noon('2026-11-17'), ['2026-11-16', '2026-11-09']);
  });
  it('Mon 16 Nov 2026 · weekday 1 last → 2026-11-09', () => {
    check({ kind: 'weekday', weekday: 1, modifier: 'last' }, noon('2026-11-16'), ['2026-11-09']);
  });
  it('Fri 13 Nov 2026 · calendar 3 Nov, no year → 2026-11-03', () => {
    check({ kind: 'calendar', day: 3, month: 11 }, noon('2026-11-13'), ['2026-11-03']);
  });
  it('Fri 13 Nov 2026 · calendar 25 Dec, no year → 2025-12-25', () => {
    check({ kind: 'calendar', day: 25, month: 12 }, noon('2026-11-13'), ['2025-12-25']);
  });
  it('Fri 13 Nov 2026 · numeric 3, 11 → 2026-11-03, 2026-03-11, ambiguous', () => {
    check({ kind: 'numeric', first: 3, second: 11 }, noon('2026-11-13'), ['2026-11-03', '2026-03-11']);
  });
  it('Fri 13 Nov 2026 · numeric 13, 11 → 2026-11-13', () => {
    check({ kind: 'numeric', first: 13, second: 11 }, noon('2026-11-13'), ['2026-11-13']);
  });
  it('Wed 11 Nov 2026, 00:10 · named yesterday → 2026-11-10', () => {
    // 2026-11-10T18:40:00.000Z is Wed 11 Nov 00:10 IST.
    check({ kind: 'named', name: 'yesterday' }, new Date('2026-11-10T18:40:00.000Z'), ['2026-11-10']);
  });
  it('Fri 13 Nov 2026 · ago 3 days → 2026-11-10', () => {
    check({ kind: 'ago', unit: 'day', n: 3 }, noon('2026-11-13'), ['2026-11-10']);
  });
  it('Fri 13 Nov 2026 · period week last → range 2026-11-02 to 2026-11-08', () => {
    check({ kind: 'period', unit: 'week', which: 'last' }, noon('2026-11-13'), [], { from: '2026-11-02', to: '2026-11-08' });
  });
  it('Fri 13 Nov 2026 · future; none → empty', () => {
    check({ kind: 'future' }, noon('2026-11-13'), []);
    check({ kind: 'none' }, noon('2026-11-13'), []);
  });
});

describe('named', () => {
  it('named today → today', () => {
    check({ kind: 'named', name: 'today' }, noon('2026-11-13'), ['2026-11-13']);
  });
});

describe('weekday this', () => {
  it('Fri 13 Nov 2026 · weekday 2 this → 2026-11-10', () => {
    check({ kind: 'weekday', weekday: 2, modifier: 'this' }, noon('2026-11-13'), ['2026-11-10']);
  });
  it('Tue 10 Nov 2026 · weekday 5 this → empty', () => {
    check({ kind: 'weekday', weekday: 5, modifier: 'this' }, noon('2026-11-10'), []);
  });
  it('Fri 13 Nov 2026 · weekday 5 this → today', () => {
    check({ kind: 'weekday', weekday: 5, modifier: 'this' }, noon('2026-11-13'), ['2026-11-13']);
  });
});

describe('calendar', () => {
  it('with a past year → that date', () => {
    check({ kind: 'calendar', day: 3, month: 11, year: 2026 }, noon('2026-11-13'), ['2026-11-03']);
  });
  it('with a future year → empty', () => {
    check({ kind: 'calendar', day: 3, month: 11, year: 2027 }, noon('2026-11-13'), []);
  });
  it('an impossible date with a year → empty', () => {
    check({ kind: 'calendar', day: 31, month: 2, year: 2025 }, noon('2026-11-13'), []);
  });
  it('29 Feb without year, from 2026 → 2024-02-29', () => {
    check({ kind: 'calendar', day: 29, month: 2 }, noon('2026-11-13'), ['2024-02-29']);
  });
  it('today’s date without year → today', () => {
    check({ kind: 'calendar', day: 13, month: 11 }, noon('2026-11-13'), ['2026-11-13']);
  });
});

describe('numeric', () => {
  it('with a year → day-first then month-first within that year', () => {
    check({ kind: 'numeric', first: 3, second: 11, year: 2026 }, noon('2026-11-13'), ['2026-11-03', '2026-03-11']);
  });
  it('both readings impossible → empty', () => {
    check({ kind: 'numeric', first: 13, second: 13 }, noon('2026-11-13'), []);
  });
  it('equal readings give one date', () => {
    check({ kind: 'numeric', first: 5, second: 5 }, noon('2026-11-13'), ['2026-05-05']);
  });
});

describe('ago', () => {
  it('ago 0 days → today', () => {
    check({ kind: 'ago', unit: 'day', n: 0 }, noon('2026-11-13'), ['2026-11-13']);
  });
  it('ago 1 week from Fri 13 Nov → range 2026-11-02 to 2026-11-08', () => {
    check({ kind: 'ago', unit: 'week', n: 1 }, noon('2026-11-13'), [], { from: '2026-11-02', to: '2026-11-08' });
  });
  it('ago 1 month from Fri 13 Nov → range 2026-10-01 to 2026-10-31', () => {
    check({ kind: 'ago', unit: 'month', n: 1 }, noon('2026-11-13'), [], { from: '2026-10-01', to: '2026-10-31' });
  });
  it('ago 1 month across a year boundary → Dec 2026', () => {
    check({ kind: 'ago', unit: 'month', n: 1 }, noon('2027-01-15'), [], { from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('period', () => {
  it('period week this → 2026-11-09 to 2026-11-13', () => {
    check({ kind: 'period', unit: 'week', which: 'this' }, noon('2026-11-13'), [], { from: '2026-11-09', to: '2026-11-13' });
  });
  it('period month this → 2026-11-01 to 2026-11-13', () => {
    check({ kind: 'period', unit: 'month', which: 'this' }, noon('2026-11-13'), [], { from: '2026-11-01', to: '2026-11-13' });
  });
  it('period month last across a year boundary → 2026-12-01 to 2026-12-31', () => {
    check({ kind: 'period', unit: 'month', which: 'last' }, noon('2027-01-05'), [], { from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('daylight saving, America/New_York', () => {
  // 2026-11-02T04:30:00Z is Sun 1 Nov 2026 23:30 EST, the day DST ended.
  const fallbackSunday = new Date('2026-11-02T04:30:00.000Z');
  it('named yesterday is 2026-10-31 and today is 2026-11-01', () => {
    check({ kind: 'named', name: 'yesterday' }, fallbackSunday, ['2026-10-31'], null, 'America/New_York');
    check({ kind: 'named', name: 'today' }, fallbackSunday, ['2026-11-01'], null, 'America/New_York');
  });
  it('ago 1 day → 2026-10-31 (calendar arithmetic, not 24 hours)', () => {
    check({ kind: 'ago', unit: 'day', n: 1 }, fallbackSunday, ['2026-10-31'], null, 'America/New_York');
  });
  it('spring forward: Mon 9 Mar 2026, yesterday → 2026-03-08', () => {
    // 2026-03-09T15:00:00Z is Mon 9 Mar 10:00 EDT, the day after the jump.
    check({ kind: 'named', name: 'yesterday' }, new Date('2026-03-09T15:00:00.000Z'), ['2026-03-08'], null, 'America/New_York');
  });
});

describe('zone errors and the clock', () => {
  it('an invalid zone throws InvalidTimeZoneError', () => {
    expect(() => resolveTimeRef({ kind: 'none' }, noon('2026-11-13'), 'Mars/Olympus')).toThrow(InvalidTimeZoneError);
  });

  afterEach(() => vi.useRealTimers());

  it('resolveTimeRef never reads the clock; it uses the now it is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const got = resolveTimeRef({ kind: 'named', name: 'today' }, noon('2026-11-13'), KOLKATA);
    expect(got.dates).toEqual(['2026-11-13']);
  });
});
