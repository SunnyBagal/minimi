/**
 * Maps a TimeRef to concrete local dates. All arithmetic is on Luxon
 * DateTimes in the given zone; `now` is the only instant used — this
 * function never reads the clock.
 *
 * One small function per row of the "Time rules" table in the lane brief.
 */
import { DateTime, type WeekdayNumbers } from 'luxon';
import type { DateCandidates, IanaTz, LocalDate, ResolveTimeRef, TimeRef } from '../contracts';
import { assertZone, localDay } from './zone';

/** A year that has a 29 February, used to check a day/month pair can exist at all. */
const LEAP_YEAR = 2000;

/** A leap day recurs within this many years, so the no-year search need look no further back. */
const LEAP_DAY_LOOKBACK_YEARS = 8;

/** The date part of a DateTime, 'yyyy-MM-dd'. All callers hold valid DateTimes. */
function iso(day: DateTime): LocalDate {
  return day.toISODate() ?? '';
}

/** The DateCandidates shape, with `ambiguous` derived from the date count. */
function result(dates: LocalDate[], range: DateCandidates['range'], rule: string): DateCandidates {
  return { dates, range, ambiguous: dates.length > 1, rule };
}

// `none`, `future`: dates empty, range null.
function resolveEmpty(rule: string): DateCandidates {
  return result([], null, rule);
}

// `named` today: [today].
// `named` yesterday: [today − 1 day].
function resolveNamed(name: 'today' | 'yesterday', today: DateTime): DateCandidates {
  if (name === 'today') return result([iso(today)], null, 'today: the local date now');
  const yesterday = today.minus({ days: 1 });
  return result([iso(yesterday)], null, 'yesterday: one day before today');
}

// `weekday`, `last`: the most recent such weekday strictly before today, then
// the same weekday in the previous ISO week if that is a different date.
function resolveLastWeekday(weekday: WeekdayNumbers, today: DateTime): DateCandidates {
  let first = today.set({ weekday });
  if (first >= today) first = first.minus({ weeks: 1 });
  const second = today.startOf('week').minus({ weeks: 1 }).set({ weekday });
  const dates = first.toISODate() === second.toISODate() ? [iso(first)] : [iso(first), iso(second)];
  return result(dates, null, 'last weekday: the most recent one before today, then that weekday in the previous ISO week');
}

// `weekday`, `bare`: the most recent such weekday including today, then the
// one a week earlier if today matches.
function resolveBareWeekday(weekday: WeekdayNumbers, today: DateTime): DateCandidates {
  let first = today.set({ weekday });
  if (first > today) first = first.minus({ weeks: 1 });
  const dates = [iso(first)];
  if (first.toISODate() === today.toISODate()) dates.push(iso(first.minus({ weeks: 1 })));
  return result(dates, null, 'bare weekday: the most recent one including today, then a week earlier when today matches');
}

// `weekday`, `this`: that weekday in the current ISO week if it is on or
// before today; otherwise empty.
function resolveThisWeekday(weekday: WeekdayNumbers, today: DateTime): DateCandidates {
  const day = today.startOf('week').set({ weekday });
  const dates = day <= today ? [iso(day)] : [];
  return result(dates, null, 'this weekday: that weekday in the current ISO week, if on or before today');
}

/** A day/month/year triple that exists as a calendar date in `zone`, else null. */
function existingDate(year: number, month: number, day: number, zone: IanaTz): DateTime | null {
  const date = DateTime.fromObject({ year, month, day }, { zone });
  return date.isValid ? date : null;
}

// `calendar` with year: that date if it exists and is on or before today;
// otherwise empty.
function resolveCalendarWithYear(year: number, month: number, day: number, today: DateTime, zone: IanaTz): DateTime | null {
  const date = existingDate(year, month, day, zone);
  return date !== null && date <= today ? date : null;
}

// `calendar` without year: the most recent occurrence on or before today.
function resolveCalendarNoYear(month: number, day: number, today: DateTime, zone: IanaTz): DateTime | null {
  // Impossible dates (31 Feb, 32 of anything) exist in no year; checking them
  // against a leap year lets every valid day/month pair through.
  if (existingDate(LEAP_YEAR, month, day, zone) === null) return null;
  for (let year = today.year; year >= today.year - LEAP_DAY_LOOKBACK_YEARS; year -= 1) {
    const date = existingDate(year, month, day, zone);
    if (date !== null && date <= today) return date;
  }
  return null;
}

// `calendar`: with a year it is that date or empty; without, the most recent
// occurrence on or before today.
function resolveCalendar(day: number, month: number, year: number | undefined, today: DateTime, zone: IanaTz): DateCandidates {
  const date = year === undefined
    ? resolveCalendarNoYear(month, day, today, zone)
    : resolveCalendarWithYear(year, month, day, today, zone);
  const rule = year === undefined
    ? 'calendar date without year: the most recent occurrence on or before today'
    : 'calendar date with year: that date if it exists and is not in the future';
  return result(date === null ? [] : [iso(date)], null, rule);
}

// `numeric`: both readings, day-first reading first, each resolved like
// `calendar`; drop impossible ones and duplicates.
function resolveNumeric(first: number, second: number, year: number | undefined, today: DateTime, zone: IanaTz): DateCandidates {
  const readings = [
    { day: first, month: second },
    { day: second, month: first },
  ];
  const dates: LocalDate[] = [];
  for (const { day, month } of readings) {
    const date = year === undefined
      ? resolveCalendarNoYear(month, day, today, zone)
      : resolveCalendarWithYear(year, month, day, today, zone);
    if (date === null) continue;
    const local = iso(date);
    if (!dates.includes(local)) dates.push(local);
  }
  return result(dates, null, 'numeric date: both the day-first and month-first readings, each resolved like a calendar date');
}

// `ago`, day: [today − n days].
// `ago`, week or month: dates empty; range = the ISO week, or calendar month,
// that contains today minus n units.
function resolveAgo(unit: 'day' | 'week' | 'month', n: number, today: DateTime): DateCandidates {
  if (!Number.isInteger(n) || n < 0) {
    return result([], null, `ago: ${JSON.stringify(n)} is not a non-negative number of ${unit}s`);
  }
  if (unit === 'day') {
    return result([iso(today.minus({ days: n }))], null, `${n} day(s) ago: that many days before today`);
  }
  const back = unit === 'week' ? today.minus({ weeks: n }) : today.minus({ months: n });
  const range = { from: iso(back.startOf(unit)), to: iso(back.endOf(unit)) };
  return result([], range, `${n} ${unit}(s) ago: the ${unit === 'week' ? 'ISO week' : 'calendar month'} containing today minus ${n} ${unit}(s)`);
}

// `period` week, last: range = previous ISO week, Monday to Sunday.
// `period` week, this: range = Monday of this week to today.
// `period` month, last or this: range = previous calendar month, or the 1st
// of this month to today.
function resolvePeriod(unit: 'week' | 'month', which: 'last' | 'this', today: DateTime): DateCandidates {
  if (which === 'this') {
    const range = { from: iso(today.startOf(unit)), to: iso(today) };
    return result([], range, `this ${unit}: from the start of this ${unit === 'week' ? 'ISO week' : 'calendar month'} to today`);
  }
  const previous =
    unit === 'week' ? today.startOf('week').minus({ weeks: 1 }) : today.startOf('month').minus({ months: 1 });
  const range = { from: iso(previous), to: iso(previous.endOf(unit)) };
  return result([], range, `last ${unit}: the whole previous ${unit === 'week' ? 'ISO week' : 'calendar month'}`);
}

export const resolveTimeRef: ResolveTimeRef = (ref, now, tz) => {
  const zone = assertZone(tz);
  const today = localDay(now, zone);
  switch (ref.kind) {
    case 'none':
      return resolveEmpty('no time phrase: nothing to look up');
    case 'future':
      return resolveEmpty('a future time phrase: there is no past date to look up');
    case 'named':
      return resolveNamed(ref.name, today);
    case 'weekday':
      if (ref.modifier === 'last') return resolveLastWeekday(ref.weekday, today);
      if (ref.modifier === 'this') return resolveThisWeekday(ref.weekday, today);
      return resolveBareWeekday(ref.weekday, today);
    case 'calendar':
      return resolveCalendar(ref.day, ref.month, ref.year, today, zone);
    case 'numeric':
      return resolveNumeric(ref.first, ref.second, ref.year, today, zone);
    case 'ago':
      return resolveAgo(ref.unit, ref.n, today);
    case 'period':
      return resolvePeriod(ref.unit, ref.which, today);
    default: {
      const never: never = ref;
      throw new Error(`Unhandled TimeRef kind: ${JSON.stringify(never)}`);
    }
  }
};
