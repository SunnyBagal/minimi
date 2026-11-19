/**
 * An assistant saved for a user turn that is already hidden must be hidden
 * too. `saveAssistant` sets the origin user id around its `saveTurn`. The
 * store reads that row inside the same transaction as the insert. Direct
 * `saveTurn` calls, including the seed, leave the origin unset and store a
 * visible row.
 */
import type { Id } from '../contracts';

let originUserId: Id | null = null;

export function withAssistantOrigin<T>(userId: Id | null, body: () => T): T {
  const previous = originUserId;
  originUserId = userId;
  try {
    return body();
  } finally {
    originUserId = previous;
  }
}

export function assistantOriginUserId(): Id | null {
  return originUserId;
}
