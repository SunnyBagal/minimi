import { DateTime, IANAZone } from 'luxon';
import type { IanaTz } from '../contracts';

/** Thrown for a zone name Luxon does not know, e.g. "Mars/Olympus". */
export class InvalidTimeZoneError extends Error {
  override readonly name = 'InvalidTimeZoneError';

  constructor(tz: string) {
    super(`"${tz}" is not a known IANA time zone.`);
  }
}

/** Throws InvalidTimeZoneError for an unknown zone; returns the zone otherwise. */
export function assertZone(tz: IanaTz): IanaTz {
  if (!IANAZone.isValidZone(tz)) throw new InvalidTimeZoneError(tz);
  return tz;
}

/** The start of the calendar day containing `instant` in `tz`. */
export function localDay(instant: Date, tz: IanaTz): DateTime {
  return DateTime.fromJSDate(instant, { zone: assertZone(tz) }).startOf('day');
}
