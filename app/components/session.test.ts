import { describe, expect, it } from 'vitest';
import { HISTORY_KEY, resetSession, SESSION_KEY, sessionId, type SessionStorage } from './session';

function memory(initial: Record<string, string> = {}): SessionStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('sessionId', () => {
  it('creates an id on first use and keeps it', () => {
    const storage = memory();
    let made = 0;
    const newId = () => `id-${++made}`;
    expect(sessionId(storage, newId)).toBe('id-1');
    expect(sessionId(storage, newId)).toBe('id-1');
    expect(made).toBe(1);
    expect(storage.data.get(SESSION_KEY)).toBe('id-1');
  });
});

describe('resetSession', () => {
  it('forgets the saved history and stores the new session id', () => {
    const storage = memory({
      [SESSION_KEY]: 'old-session',
      [HISTORY_KEY]: '[{"id":"m1","role":"user","parts":[]}]',
      'minimi.theme': 'dark',
    });
    expect(resetSession(storage, 'new-session')).toBe('new-session');
    expect(storage.data.get(SESSION_KEY)).toBe('new-session');
    expect(storage.data.has(HISTORY_KEY)).toBe(false);
  });

  it('leaves other keys (the theme choice) alone', () => {
    const storage = memory({ [SESSION_KEY]: 'old', 'minimi.theme': 'dark' });
    resetSession(storage, 'new');
    expect(storage.data.get('minimi.theme')).toBe('dark');
  });

  it('the next sessionId call returns the new id without making another', () => {
    const storage = memory({ [SESSION_KEY]: 'old' });
    resetSession(storage, 'fresh');
    expect(
      sessionId(storage, () => {
        throw new Error('should not create');
      }),
    ).toBe('fresh');
  });

  it('works when nothing was saved yet', () => {
    const storage = memory();
    resetSession(storage, 'first');
    expect(storage.data.get(SESSION_KEY)).toBe('first');
  });
});
