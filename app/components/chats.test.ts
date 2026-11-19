import { describe, expect, it } from 'vitest';
import {
  applyMigration,
  CHATS_KEY,
  chatStorageKey,
  chatTitle,
  coveredControlsInert,
  deleteChat,
  editAnchor,
  editApplied,
  latestCreatedAt,
  loadSessionMessages,
  messagesBefore,
  newChatClosesSidebar,
  orderChats,
  persistChatRecord,
  readSidebarOpen,
  relativeDay,
  requestSessionId,
  serverUserTurnId,
  shouldWriteTranscript,
  SIDEBAR_KEY,
  snapshotChat,
  TITLE_LIMIT,
  upsertChat,
  writeSidebarOpen,
  type ChatRow,
} from './chats';
import { HISTORY_KEY, SESSION_KEY, type SessionStorage } from './session';

function memory(initial: Record<string, string> = {}): SessionStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const NOW = '2026-11-19T15:00:00.000Z';

describe('chatTitle', () => {
  it('trims whitespace, capitalises, and caps titles at 48 characters', () => {
    expect(chatTitle('  hello   \n world  ')).toBe('Hello world');
    expect(chatTitle('   ')).toBe('New chat');
    const long = 'a'.repeat(TITLE_LIMIT + 5);
    expect(chatTitle(long)).toBe(`A${'a'.repeat(TITLE_LIMIT - 1)}`);
    expect(chatTitle(long).length).toBe(48);
    expect(chatTitle('Find the latest documentation page for Supabase authentication')).toBe(
      'Find the latest documentation page for Supabase',
    );
  });

  it.each([
    ['From earlier, how long will it take to finish GTA 6?', 'Finish GTA 6'],
    ["What does Supabase's Pro plan cost right now?", "Supabase's Pro plan cost"],
    ['Earlier today I asked you about Postgres hosting?', 'Postgres hosting'],
    ['Please, can you explain row-level security right now ?', 'Explain row-level security'],
  ])('cleans %s into %s', (question, expected) => {
    expect(chatTitle(question)).toBe(expected);
  });
});

describe('orderChats / upsertChat / deleteChat', () => {
  const older: ChatRow = { id: 'a', title: 'Older', updatedAt: '2026-11-01T00:00:00.000Z' };
  const newer: ChatRow = { id: 'b', title: 'Newer', updatedAt: '2026-11-02T00:00:00.000Z' };

  it('lists newest first, replaces a row on upsert, and drops one on delete', () => {
    expect(orderChats([older, newer]).map((row) => row.id)).toEqual(['b', 'a']);
    expect(orderChats([older, newer])).not.toBe([older, newer]);
    const updated = upsertChat([older, newer], { id: 'a', title: 'Moved', updatedAt: '2026-11-03T00:00:00.000Z' });
    expect(updated.map((row) => row.id)).toEqual(['a', 'b']);
    expect(updated[0]?.title).toBe('Moved');
    expect(deleteChat(updated, 'b').map((row) => row.id)).toEqual(['a']);
    expect(deleteChat(updated, 'missing').map((row) => row.id)).toEqual(['a', 'b']);
  });
});

describe('relativeDay', () => {
  it('shows the day and local clock time in the caller zone', () => {
    expect(relativeDay('2026-11-19T14:14:00.000Z', NOW, 'UTC', 'en-GB')).toBe('Today, 2:14 pm');
    expect(relativeDay('2026-11-18T09:05:00.000Z', NOW, 'UTC', 'en-GB')).toBe('Yesterday, 9:05 am');
    expect(relativeDay('2026-11-19T01:00:00.000Z', NOW, 'America/Los_Angeles', 'en-GB')).toBe('Yesterday, 5:00 pm');
    expect(relativeDay('2026-11-17T16:30:00.000Z', NOW, 'UTC', 'en-GB')).toBe('17 Nov, 4:30 pm');
    expect(relativeDay('not-a-date', NOW, 'UTC', 'en-GB')).toBe('');
  });

  it('uses locale-specific date ordering', () => {
    expect(relativeDay('2026-11-17T16:30:00.000Z', NOW, 'UTC', 'en-US')).toBe('Nov 17, 4:30 pm');
  });
});

describe('snapshotChat / messagesBefore / serverUserTurnId', () => {
  it('titles a chat from the first user message and prefers a stored timestamp', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '  hello   there ' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hi' }], metadata: { createdAtUtc: '2026-11-02T00:00:00.000Z', userTurnId: 'srv-1' } },
    ];
    expect(snapshotChat(messages, 's1', NOW)).toEqual({
      id: 's1',
      title: 'Hello there',
      updatedAt: '2026-11-02T00:00:00.000Z',
    });
    expect(latestCreatedAt(messages)).toBe('2026-11-02T00:00:00.000Z');
    expect(snapshotChat([{ id: 'a', role: 'assistant', parts: [] }], 's1', NOW)).toBeNull();
    expect(snapshotChat([{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'only' }] }], 's1', NOW)?.updatedAt).toBe(NOW);
    expect(messagesBefore(messages, 'u1')).toEqual([]);
    expect(messagesBefore(messages, 'missing').map((message) => message.id)).toEqual(['u1', 'a1']);
    expect(serverUserTurnId(messages.slice(1))).toBe('srv-1');
    expect(serverUserTurnId([{ metadata: {} }])).toBeNull();
    expect(editAnchor(messages.slice(1))).toBe('srv-1');
    expect(editAnchor([{ metadata: { turnId: 'asst-old' } }])).toBe('asst-old');
    expect(editAnchor([{ metadata: { userTurnId: 'u', turnId: 'a' } }])).toBe('u');
    expect(editAnchor([{ metadata: {} }])).toBeNull();
    expect(editAnchor([])).toBeNull();
  });
});

describe('edit and session helpers', () => {
  it('sends with the tab session and writes an edit only after the server applies it', () => {
    const readStored = () => 'other-tab';
    expect(requestSessionId('this-tab', readStored)).toBe('this-tab');
    expect(requestSessionId('', readStored)).toBe('other-tab');
    expect(editApplied({ isAbort: false, isDisconnect: false, isError: false })).toBe(false);
    expect(editApplied({ isAbort: false, isDisconnect: false, isError: false, turnId: 'turn-1' })).toBe(true);
    expect(editApplied({ isAbort: false, isDisconnect: false, isError: false, turnId: '' })).toBe(false);
    expect(editApplied({ isAbort: false, isDisconnect: true, isError: true, turnId: 'turn-1' })).toBe(false);
    expect(editApplied({ isAbort: true, isDisconnect: false, isError: false })).toBe(false);
    expect(editApplied({ isAbort: false, isDisconnect: false, isError: true })).toBe(false);
    expect(editApplied({ isAbort: false, isDisconnect: false, isError: false, finishReason: 'interrupted' })).toBe(false);
    expect(shouldWriteTranscript(true, 'ready')).toBe(false);
    expect(shouldWriteTranscript(false, 'streaming')).toBe(false);
    expect(shouldWriteTranscript(false, 'submitted')).toBe(false);
    expect(shouldWriteTranscript(false, 'ready')).toBe(true);
    expect(shouldWriteTranscript(false, 'error')).toBe(true);
  });

  it('closes the phone overlay on new chat and keeps covered controls out of the tab order', () => {
    expect(newChatClosesSidebar(true)).toBe(true);
    expect(newChatClosesSidebar(false)).toBe(false);
    expect(coveredControlsInert(true, true)).toBe(true);
    expect(coveredControlsInert(true, false)).toBe(false);
    expect(coveredControlsInert(false, true)).toBe(false);
  });
});

describe('applyMigration', () => {
  const legacy = JSON.stringify([
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Remember this' }] },
    { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
  ]);

  it('moves minimi.messages into the index once, and leaves an existing index alone', () => {
    const storage = memory({ [HISTORY_KEY]: legacy, [SESSION_KEY]: 'sess-1' });
    const index = applyMigration(storage, 'sess-1', NOW);
    expect(index).toEqual([{ id: 'sess-1', title: 'Remember this', updatedAt: NOW }]);
    expect(storage.data.has(HISTORY_KEY)).toBe(false);
    expect(storage.data.get(CHATS_KEY)).toContain('Remember this');
    expect(storage.data.get(chatStorageKey('sess-1'))).toContain('Remember this');

    storage.data.set(HISTORY_KEY, legacy);
    storage.data.set(CHATS_KEY, JSON.stringify([{ id: 'kept', title: 'Kept', updatedAt: '2026-11-01T00:00:00.000Z' }]));
    const again = applyMigration(storage, 'sess-1', NOW);
    expect(again.map((row) => row.id)).toEqual(['kept']);
    expect(storage.data.get(HISTORY_KEY)).toBe(legacy);
  });

  it('replaces an unreadable index by migrating legacy messages', () => {
    const storage = memory({ [CHATS_KEY]: '{not json', [HISTORY_KEY]: legacy });
    expect(applyMigration(storage, 'sess-9', NOW).map((row) => row.id)).toEqual(['sess-9']);
    expect(storage.data.has(HISTORY_KEY)).toBe(false);
    expect(parseStored(storage.data.get(CHATS_KEY))).toEqual([
      { id: 'sess-9', title: 'Remember this', updatedAt: NOW },
    ]);
  });

  it('refreshes all indexed titles from the saved transcripts without changing activity dates', () => {
    const rows = [
      { id: 'open-chat', title: 'How long will it take to finish GTA 6?', updatedAt: NOW },
      { id: 'closed-chat', title: 'Earlier today I asked you about Redis?', updatedAt: '2026-11-17T09:00:00.000Z' },
    ];
    const storage = memory({ [CHATS_KEY]: JSON.stringify(rows) });
    for (const row of rows) {
      storage.data.set(chatStorageKey(row.id), JSON.stringify([{ role: 'user', parts: [{ type: 'text', text: row.title }] }]));
    }
    const expected = [
      { ...rows[0], title: 'Finish GTA 6' },
      { ...rows[1], title: 'Redis' },
    ];
    expect(applyMigration(storage, 'open-chat', NOW)).toEqual(expected);
    expect(parseStored(storage.data.get(CHATS_KEY))).toEqual(expected);
  });

  it('writes an empty index when there is nothing to migrate', () => {
    const storage = memory();
    expect(applyMigration(storage, 'sess-1', NOW)).toEqual([]);
    expect(storage.data.get(CHATS_KEY)).toBe('[]');
    expect(applyMigration(storage, 'sess-1', NOW)).toEqual([]);
  });

  it('keeps the legacy transcript when the new transcript cannot be stored', () => {
    const data = new Map<string, string>([[HISTORY_KEY, legacy]]);
    const storage: SessionStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        if (key.startsWith('minimi.chat.')) throw new Error('quota');
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    };
    expect(applyMigration(storage, 'sess-1', NOW)).toEqual([]);
    expect(data.get(HISTORY_KEY)).toBe(legacy);
    expect(data.has(CHATS_KEY)).toBe(false);
    expect([...data.keys()].some((key) => key.startsWith('minimi.chat.'))).toBe(false);
    const loaded = loadSessionMessages<{ role: string }>(storage, 'sess-1');
    expect(loaded.fromLegacy).toBe(true);
    expect(loaded.messages).toHaveLength(2);
  });

  it('keeps the legacy transcript when the index cannot be stored', () => {
    const data = new Map<string, string>([[HISTORY_KEY, legacy]]);
    const storage: SessionStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        if (key === CHATS_KEY) throw new Error('quota');
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    };
    expect(applyMigration(storage, 'sess-1', NOW)).toEqual([]);
    expect(data.get(HISTORY_KEY)).toBe(legacy);
    expect(data.get(chatStorageKey('sess-1'))).toContain('Remember this');
    expect(data.has(CHATS_KEY)).toBe(false);
  });

  it('treats a throwing store as empty and does not throw', () => {
    const storage: SessionStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(applyMigration(storage, 'sess-1', NOW)).toEqual([]);
    expect(readSidebarOpen(storage)).toBe(false);
    expect(() => writeSidebarOpen(storage, true)).not.toThrow();
  });
});

describe('loadSessionMessages and persistChatRecord', () => {
  const legacy = JSON.stringify([
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Remember this' }] },
  ]);
  const row: ChatRow = { id: 'sess-1', title: 'Remember this', updatedAt: NOW };

  it('keeps the legacy key when the index write fails after the transcript write', () => {
    const data = new Map<string, string>([[HISTORY_KEY, legacy]]);
    const storage: SessionStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        if (key === CHATS_KEY) throw new Error('quota');
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    };
    expect(persistChatRecord(storage, 'sess-1', [{ role: 'user' }], [row], true)).toBe(false);
    expect(data.get(HISTORY_KEY)).toBe(legacy);
    expect(data.has(CHATS_KEY)).toBe(false);
    expect(data.get(chatStorageKey('sess-1'))).toContain('user');
    expect(loadSessionMessages(storage, 'sess-1').fromLegacy).toBe(false);
  });

  it('does not show a legacy transcript for a session the index does not list', () => {
    const storage = memory({
      [HISTORY_KEY]: legacy,
      [CHATS_KEY]: JSON.stringify([{ id: 'other', title: 'Other', updatedAt: NOW }]),
    });
    expect(loadSessionMessages(storage, 'sess-1')).toEqual({ messages: null, fromLegacy: false });
  });

  it('clears the legacy key only for the session that still depends on it', () => {
    const storage = memory({ [HISTORY_KEY]: legacy });
    expect(persistChatRecord(storage, 'other', [{ role: 'user' }], [{ id: 'other', title: 'Other', updatedAt: NOW }], false)).toBe(true);
    expect(storage.data.get(HISTORY_KEY)).toBe(legacy);
    expect(persistChatRecord(storage, 'sess-1', [{ role: 'user' }], [row], true)).toBe(true);
    expect(storage.data.has(HISTORY_KEY)).toBe(false);
    expect(loadSessionMessages(storage, 'sess-1').fromLegacy).toBe(false);
  });
});

describe('sidebar open flag', () => {
  it('is closed unless the stored value is open', () => {
    const storage = memory();
    expect(readSidebarOpen(storage)).toBe(false);
    writeSidebarOpen(storage, true);
    expect(storage.data.get(SIDEBAR_KEY)).toBe('open');
    expect(readSidebarOpen(storage)).toBe(true);
    writeSidebarOpen(storage, false);
    expect(readSidebarOpen(storage)).toBe(false);
  });
});

function parseStored(raw: string | undefined): unknown {
  return JSON.parse(raw ?? 'null');
}
