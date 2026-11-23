/**
 * Forgetting a chat. Deleting a chat in the sidebar also hides its turns in server
 * memory, so recall can no longer find a conversation the user deleted. It is the same
 * soft delete as edit-in-place (`hideFrom`): rows stay on disk, marked hidden, and every
 * memory lookup skips hidden turns.
 */
import type { Id, MemoryStore } from '../../../src/core/contracts';

/** Hides every visible turn of the session. Returns how many turns were hidden (0 for an unknown session). */
export function forgetSession(store: MemoryStore, sessionId: Id): number {
  const firstUser = store.recentTurns(sessionId, Number.MAX_SAFE_INTEGER).find((turn) => turn.role === 'user');
  return firstUser === undefined ? 0 : store.hideFrom(sessionId, firstUser.id);
}
