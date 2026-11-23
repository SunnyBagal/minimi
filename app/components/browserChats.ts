/**
 * Chats this browser still has from the dates a recall looked up. When the server has
 * no record of a day (the live demo's memory is per instance and can reset) but the
 * browser saved a chat from it, the answer card says so and offers to open it, rather
 * than leaving "No matching conversation" as the last word.
 */
import type { DateCandidates } from '../../src/core/contracts';
import { calendarDay, CHATS_KEY, parseChatIndex, readChatMessages, type ChatMessage } from './chats';
import type { SessionStorage } from './session';

export interface BrowserChat {
  id: string;
  title: string;
  /** Local dates (YYYY-MM-DD) of the chat's timestamped messages. */
  dates: string[];
}

export interface BrowserChatMatch {
  id: string;
  title: string;
  date: string;
}

/** Local dates of the messages that carry a timestamp. Older chats saved without one have none. */
export function chatDates(messages: readonly ChatMessage[], timeZone: string): string[] {
  const dates = new Set<string>();
  for (const message of messages) {
    const iso = message.metadata?.createdAtUtc;
    if (typeof iso !== 'string' || iso === '') continue;
    const day = calendarDay(iso, timeZone);
    if (day !== '') dates.add(day);
  }
  return [...dates].sort();
}

/** Saved chats, other than the open one, with a message on a tried date (or in the tried range). */
export function browserChatsOn(
  candidates: Pick<DateCandidates, 'dates' | 'range'>,
  chats: readonly BrowserChat[],
  excludeId: string,
): BrowserChatMatch[] {
  const tried = (date: string) =>
    candidates.dates.includes(date) ||
    (candidates.range !== null && date >= candidates.range.from && date <= candidates.range.to);
  const out: BrowserChatMatch[] = [];
  for (const chat of chats) {
    if (chat.id === excludeId) continue;
    const date = chat.dates.find(tried);
    if (date !== undefined) out.push({ id: chat.id, title: chat.title, date });
  }
  return out;
}

/** Every saved chat with the dates of its messages, read from browser storage. */
export function readBrowserChats(storage: SessionStorage, timeZone: string): BrowserChat[] {
  const index = parseChatIndex(storage.getItem(CHATS_KEY)) ?? [];
  return index.map((row) => ({
    id: row.id,
    title: row.title,
    dates: chatDates(readChatMessages<ChatMessage>(storage, row.id) ?? [], timeZone),
  }));
}
