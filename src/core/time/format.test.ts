import { describe, expect, it } from 'vitest';
import { time } from './index';
import { formatLocal, toLocalDate } from './format';
import { InvalidTimeZoneError } from './zone';

describe('toLocalDate', () => {
  it('New York instant on its own date', () => {
    expect(toLocalDate(new Date('2026-10-31T04:30:00Z'), 'America/New_York')).toBe('2026-10-31');
  });
  it('one instant, two zones', () => {
    const instant = new Date('2026-11-10T07:30:00Z');
    expect(toLocalDate(instant, 'America/Los_Angeles')).toBe('2026-11-09');
    expect(toLocalDate(instant, 'Asia/Kolkata')).toBe('2026-11-10');
  });
  it('throws InvalidTimeZoneError for a bad zone', () => {
    expect(() => toLocalDate(new Date('2026-11-10T07:30:00Z'), 'Mars/Olympus')).toThrow(InvalidTimeZoneError);
  });
});

describe('formatLocal', () => {
  it('contains the local date and time', () => {
    const text = formatLocal('2026-11-10T08:35:00.000Z', 'Asia/Kolkata');
    expect(text).toContain('Tue 10 Nov 2026');
    expect(text).toContain('14:05');
  });
  it('throws InvalidTimeZoneError for a bad zone', () => {
    expect(() => formatLocal('2026-11-10T08:35:00.000Z', 'Mars/Olympus')).toThrow(InvalidTimeZoneError);
  });
});

describe('time entry module', () => {
  it('exposes the three functions', () => {
    expect(time.resolveTimeRef).toBeTypeOf('function');
    expect(time.toLocalDate).toBeTypeOf('function');
    expect(time.formatLocal).toBeTypeOf('function');
  });
});
