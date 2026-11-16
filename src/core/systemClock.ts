import type { Clock } from './contracts';

/** The real clock. This file is the one place in src/core that may read the system time. */
export const systemClock: Clock = {
  now: () => new Date(),
};
