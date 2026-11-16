import { DateTime } from 'luxon';
import type { FormatLocal, ToLocalDate } from '../contracts';
import { assertZone, localDay } from './zone';

/** The calendar date of `instant` in `tz`, as 'yyyy-MM-dd'. */
export const toLocalDate: ToLocalDate = (instant, tz) => localDay(instant, tz).toISODate() ?? '';

/** "Tue 10 Nov 2026, 14:05 GMT+5:30" — the zone label is whatever Luxon/Intl gives. */
export const formatLocal: FormatLocal = (instant, tz) =>
  DateTime.fromISO(instant).setZone(assertZone(tz)).setLocale('en-GB').toFormat('ccc d LLL yyyy, HH:mm ZZZZ');
