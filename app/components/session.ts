/**
 * The browser side of a conversation: the session id the server keys turns
 * by, and the saved message history. Both live in localStorage.
 */

export const SESSION_KEY = 'minimi.sessionId';
export const HISTORY_KEY = 'minimi.messages';

export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The session id, created with `newId` on first use and kept in storage. */
export function sessionId(storage: SessionStorage, newId: () => string): string {
  let id = storage.getItem(SESSION_KEY);
  if (id === null) {
    id = newId();
    storage.setItem(SESSION_KEY, id);
  }
  return id;
}

/**
 * Starts a new conversation: forgets the saved history and stores `uuid` as
 * the session id. Returns the new id. Earlier sessions stay on the server.
 */
export function resetSession(storage: SessionStorage, uuid: string): string {
  storage.removeItem(HISTORY_KEY);
  storage.setItem(SESSION_KEY, uuid);
  return uuid;
}
