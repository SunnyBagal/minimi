/**
 * Chat index kept in the browser. The server still keys turns by session id;
 * this index is only the list the sidebar shows, plus each chat's messages.
 */
import { HISTORY_KEY, type SessionStorage } from './session';

export const CHATS_KEY = 'minimi.chats';
export const SIDEBAR_KEY = 'minimi.sidebar';
export const TITLE_LIMIT = 60;

export interface ChatRow {
  id: string;
  title: string;
  updatedAt: string;
}

interface TextPart {
  type: string;
  text?: unknown;
}

export interface ChatMessage {
  id?: string;
  role: string;
  parts?: readonly TextPart[];
  metadata?: { createdAtUtc?: string; userTurnId?: string };
}

export function chatStorageKey(id: string): string {
  return `minimi.chat.${id}`;
}

/** First user message, trimmed, whitespace collapsed, cut at 60 characters. */
export function chatTitle(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  if (collapsed === '') return 'New chat';
  return collapsed.length <= TITLE_LIMIT ? collapsed : collapsed.slice(0, TITLE_LIMIT);
}

export function orderChats(chats: readonly ChatRow[]): ChatRow[] {
  return [...chats].sort((a, b) => {
    if (a.updatedAt === b.updatedAt) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
}

export function upsertChat(chats: readonly ChatRow[], row: ChatRow): ChatRow[] {
  return orderChats([...chats.filter((chat) => chat.id !== row.id), row]);
}

export function deleteChat(chats: readonly ChatRow[], id: string): ChatRow[] {
  return chats.filter((chat) => chat.id !== id);
}

function calendarDay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(formatted);
  return match === null ? '' : `${match[1]}-${match[2]}-${match[3]}`;
}

function previousCalendarDay(yyyyMmDd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (match === null) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const prev = new Date(Date.UTC(year, month - 1, day - 1));
  const y = prev.getUTCFullYear();
  const m = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const d = String(prev.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "Today", "Yesterday", or a short local date. `nowIso` and `timeZone` come from the caller. */
export function relativeDay(updatedAt: string, nowIso: string, timeZone: string): string {
  const updated = calendarDay(updatedAt, timeZone);
  const now = calendarDay(nowIso, timeZone);
  if (updated === '' || now === '') return '';
  if (updated === now) return 'Today';
  if (updated === previousCalendarDay(now)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(new Date(updatedAt));
}

function textOfMessage(message: { parts?: readonly TextPart[] }): string {
  return (message.parts ?? [])
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

export function latestCreatedAt(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const iso = messages[index]?.metadata?.createdAtUtc;
    if (typeof iso === 'string' && iso !== '') return iso;
  }
  return null;
}

/** A sidebar row for this transcript, or null when it has no user message yet. */
export function snapshotChat(messages: readonly ChatMessage[], id: string, fallbackIso: string): ChatRow | null {
  const user = messages.find((message) => message.role === 'user');
  if (user === undefined) return null;
  return { id, title: chatTitle(textOfMessage(user)), updatedAt: latestCreatedAt(messages) ?? fallbackIso };
}

/** Messages strictly before `userMessageId`. An unknown id returns the list unchanged. */
export function messagesBefore<M extends { id: string }>(messages: readonly M[], userMessageId: string): M[] {
  const index = messages.findIndex((message) => message.id === userMessageId);
  if (index < 0) return [...messages];
  return messages.slice(0, index);
}

/** Server user-turn id carried on the assistant message that answered this turn. */
export function serverUserTurnId(answers: readonly { metadata?: { userTurnId?: string } }[]): string | null {
  for (const answer of answers) {
    const id = answer.metadata?.userTurnId;
    if (typeof id === 'string' && id !== '') return id;
  }
  return null;
}

/**
 * Id sent as editFrom. Prefers the user turn. An older assistant message only
 * has turnId; the server resolves that to the preceding user turn. Neither
 * id means the message cannot be edited.
 */
export function editAnchor(
  answers: readonly { metadata?: { userTurnId?: string; turnId?: string } }[],
): string | null {
  const user = serverUserTurnId(answers);
  if (user !== null) return user;
  for (const answer of answers) {
    const id = answer.metadata?.turnId;
    if (typeof id === 'string' && id !== '') return id;
  }
  return null;
}

/** The tab's session, unless this tab has not restored one yet. */
export function requestSessionId(tabSessionId: string, readStored: () => string): string {
  if (tabSessionId !== '') return tabSessionId;
  return readStored();
}

/**
 * Write the truncated transcript only after the server has applied the edit.
 * A finished UI stream carries the saved assistant turn id. A stream that
 * closes before that acknowledgement does not count, even when finishReason
 * is missing.
 */
export function editApplied(flags: {
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
  finishReason?: string;
  turnId?: string;
}): boolean {
  if (flags.isAbort || flags.isDisconnect || flags.isError || flags.finishReason === 'interrupted') return false;
  return typeof flags.turnId === 'string' && flags.turnId !== '';
}

/** Skip the local transcript write while an edit is in flight or the stream is open. */
export function shouldWriteTranscript(holdingEdit: boolean, status: string): boolean {
  if (holdingEdit) return false;
  return status !== 'submitted' && status !== 'streaming';
}

/** New chat on a phone closes the overlay. A wide window leaves the sidebar as it is. */
export function newChatClosesSidebar(phone: boolean): boolean {
  return phone;
}

/** Header and transcript stay out of the tab order while the phone overlay is open. */
export function coveredControlsInert(phone: boolean, sidebarOpen: boolean): boolean {
  return phone && sidebarOpen;
}

function getItem(storage: SessionStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function setItem(storage: SessionStorage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    // Private-mode storage can throw. The on-screen state still updates.
    return false;
  }
}

function removeItem(storage: SessionStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Same as setItem: a refused delete leaves the in-memory list as the source of truth.
  }
}

function isChatRow(value: unknown): value is ChatRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as ChatRow;
  return typeof row.id === 'string' && row.id !== '' && typeof row.title === 'string' && typeof row.updatedAt === 'string';
}

/** Parsed index, or null when the key is missing or unreadable. */
export function parseChatIndex(raw: string | null): ChatRow[] | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || !value.every(isChatRow)) return null;
    return value;
  } catch {
    return null;
  }
}

export function readChatIndex(storage: SessionStorage): ChatRow[] {
  return orderChats(parseChatIndex(getItem(storage, CHATS_KEY)) ?? []);
}

export function writeChatIndex(storage: SessionStorage, chats: readonly ChatRow[]): boolean {
  return setItem(storage, CHATS_KEY, JSON.stringify(chats));
}

/**
 * Messages for this session. The per-chat key wins. When it is missing, the
 * legacy transcript is shown until both destination writes succeed, unless
 * the index already lists other chats and not this one.
 */
export function loadSessionMessages<T>(
  storage: SessionStorage,
  id: string,
): { messages: T[] | null; fromLegacy: boolean } {
  const stored = readChatMessages<T>(storage, id);
  if (stored !== null) return { messages: stored, fromLegacy: false };
  const legacy = parseLegacyMessages(getItem(storage, HISTORY_KEY));
  if (legacy === null) return { messages: null, fromLegacy: false };
  const index = parseChatIndex(getItem(storage, CHATS_KEY));
  if (index !== null && index.length > 0 && !index.some((row) => row.id === id)) {
    return { messages: null, fromLegacy: false };
  }
  return { messages: legacy as T[], fromLegacy: true };
}

/**
 * Writes the transcript, then the index. Returns false when either write
 * fails and leaves the legacy key in place. Clears that key only after both
 * writes succeed and `clearLegacy` is set.
 */
export function persistChatRecord(
  storage: SessionStorage,
  id: string,
  messages: unknown,
  index: readonly ChatRow[],
  clearLegacy: boolean,
): boolean {
  if (!writeChatMessages(storage, id, messages)) return false;
  if (!writeChatIndex(storage, index)) return false;
  if (clearLegacy) removeItem(storage, HISTORY_KEY);
  return true;
}

export function readChatMessages<T>(storage: SessionStorage, id: string): T[] | null {
  const raw = getItem(storage, chatStorageKey(id));
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    return value as T[];
  } catch {
    return null;
  }
}

export function writeChatMessages(storage: SessionStorage, id: string, messages: unknown): boolean {
  return setItem(storage, chatStorageKey(id), JSON.stringify(messages));
}

export function removeChatMessages(storage: SessionStorage, id: string): void {
  removeItem(storage, chatStorageKey(id));
}

export function readSidebarOpen(storage: SessionStorage): boolean {
  return getItem(storage, SIDEBAR_KEY) === 'open';
}

export function writeSidebarOpen(storage: SessionStorage, open: boolean): void {
  setItem(storage, SIDEBAR_KEY, open ? 'open' : 'closed');
}

function parseLegacyMessages(raw: string | null): ChatMessage[] | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    return value as ChatMessage[];
  } catch {
    return null;
  }
}

/**
 * First load moves `minimi.messages` into the index. An index that already
 * parses is left as it is, including its legacy key. A missing or unreadable
 * index is replaced so this does not run again. The legacy key is removed
 * only after every destination write for that migration has succeeded.
 */
export function applyMigration(storage: SessionStorage, currentSessionId: string, savedAtIso: string): ChatRow[] {
  const existing = parseChatIndex(getItem(storage, CHATS_KEY));
  if (existing !== null) return orderChats(existing);

  const legacyRaw = getItem(storage, HISTORY_KEY);
  const legacy = parseLegacyMessages(legacyRaw);
  const row = legacy === null ? null : snapshotChat(legacy, currentSessionId, savedAtIso);
  if (legacy !== null && row !== null) {
    if (!writeChatMessages(storage, currentSessionId, legacy)) return [];
    if (!writeChatIndex(storage, [row])) return [];
    removeItem(storage, HISTORY_KEY);
    return [row];
  }

  if (!writeChatIndex(storage, [])) return [];
  if (legacyRaw !== null) removeItem(storage, HISTORY_KEY);
  return [];
}
