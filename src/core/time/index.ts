// Entry module for the time functions. `time` is the injected TimeFns;
// InvalidTimeZoneError is exported so callers (the route's UTC fallback,
// tests) can recognise a bad zone.
import type { TimeFns } from '../contracts';
import { formatLocal, toLocalDate } from './format';
import { resolveTimeRef } from './resolve';

export const time: TimeFns = { resolveTimeRef, toLocalDate, formatLocal };

export { InvalidTimeZoneError } from './zone';
