import { describe, expect, it } from 'vitest';
import { browserChatsOn, chatDates, readBrowserChats } from './browserChats';
import { CHATS_KEY, chatStorageKey } from './chats';

const TZ = 'Asia/Kolkata';
const tried = { dates: ['2026-11-19'], range: null };

function memoryStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe('chatDates', () => {
  it('takes the local date of each timestamped message, in the viewer zone', () => {
    const messages = [
      { role: 'user' },
      { role: 'assistant', metadata: { createdAtUtc: '2026-11-19T06:10:00.000Z' } }, // 11:40 IST, 19 Nov
      { role: 'assistant', metadata: { createdAtUtc: '2026-11-19T19:00:00.000Z' } }, // 00:30 IST, 20 Nov
    ];
    expect(chatDates(messages, TZ)).toEqual(['2026-11-19', '2026-11-20']);
  });

  it('an older chat saved without timestamps has no dates, so it is never guessed', () => {
    expect(chatDates([{ role: 'user' }, { role: 'assistant' }], TZ)).toEqual([]);
  });
});

describe('browserChatsOn', () => {
  const chats = [
    { id: 'gta', title: 'Finish GTA 6', dates: ['2026-11-19'] },
    { id: 'gta-2', title: 'Finish GTA 6', dates: ['2026-11-18', '2026-11-19'] },
    { id: 'neon', title: 'Neon price', dates: ['2026-11-12'] },
    { id: 'open', title: 'What did I ask about GTA 6 on Thursday?', dates: ['2026-11-19'] },
  ];

  it('finds the saved chats from a tried date, leaving out the open chat', () => {
    expect(browserChatsOn(tried, chats, 'open')).toEqual([
      { id: 'gta', title: 'Finish GTA 6', date: '2026-11-19' },
      { id: 'gta-2', title: 'Finish GTA 6', date: '2026-11-19' },
    ]);
  });

  it('counts a tried range, and finds nothing when no chat falls in it', () => {
    expect(browserChatsOn({ dates: [], range: { from: '2026-11-10', to: '2026-11-13' } }, chats, 'open')).toEqual([
      { id: 'neon', title: 'Neon price', date: '2026-11-12' },
    ]);
    expect(browserChatsOn({ dates: ['2026-11-01'], range: null }, chats, 'open')).toEqual([]);
    expect(browserChatsOn({ dates: [], range: null }, chats, 'open')).toEqual([]);
  });
});

describe('readBrowserChats', () => {
  it('reads the sidebar index and each chat’s message dates from storage', () => {
    const storage = memoryStorage({
      [CHATS_KEY]: JSON.stringify([{ id: 'gta', title: 'Finish GTA 6', updatedAt: '2026-11-19T06:11:00.000Z' }]),
      [chatStorageKey('gta')]: JSON.stringify([
        { role: 'user', parts: [{ type: 'text', text: 'How long will it take to finish GTA 6?' }] },
        { role: 'assistant', metadata: { createdAtUtc: '2026-11-19T06:11:00.000Z' } },
      ]),
    });
    expect(readBrowserChats(storage, TZ)).toEqual([{ id: 'gta', title: 'Finish GTA 6', dates: ['2026-11-19'] }]);
    expect(readBrowserChats(memoryStorage({}), TZ)).toEqual([]);
  });
});
