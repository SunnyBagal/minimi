'use client';

/**
 * The chat page: header, the conversation as turns (user bubble, answer
 * card with recall card, markdown with citations, verdict table, sources,
 * errors), the transient status, timings under the last answer, and a
 * composer fixed to the bottom. The ASCII cat field sits behind it all.
 */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { SourceRef, VerdictRow } from '../src/core/contracts';
import { systemClock } from '../src/core/systemClock';
import type { ChatUIMessage } from './api/chat/route';
import { CatField } from './components/CatField';
import {
  applyMigration,
  coveredControlsInert,
  deleteChat,
  editAnchor,
  editApplied,
  loadSessionMessages,
  messagesBefore,
  newChatClosesSidebar,
  persistChatRecord,
  readChatIndex,
  readSidebarOpen,
  removeChatMessages,
  requestSessionId,
  shouldWriteTranscript,
  snapshotChat,
  transcriptTitle,
  upsertChat,
  writeChatIndex,
  writeSidebarOpen,
  type ChatRow,
} from './components/chats';
import { DevFooter } from './components/DevFooter';
import { ChatEvalsContent, SuiteContent } from './components/EvalsPopovers';
import {
  ChatsIcon,
  CheckIcon,
  CopyIcon,
  EditIcon,
  FlaskIcon,
  MoonIcon,
  NewChatIcon,
  PulseIcon,
  SendIcon,
  SunIcon,
} from './components/icons';
import { MenuPopover } from './components/MenuPopover';
import { Markdown } from './components/Markdown';
import { Oneko } from './components/Oneko';
import { RecallCard } from './components/RecallCard';
import { SESSION_KEY, sessionId } from './components/session';
import { Sidebar } from './components/Sidebar';
import { Sources } from './components/Sources';
import { Alert, StatusLine } from './components/StatusLine';
import { effectiveTheme, nextTheme, writeTheme } from './components/theme';
import { groupTurns, textOf } from './components/turns';
import { VerdictBlock } from './components/VerdictBlock';

const EXAMPLES = [
  "What does Supabase's Pro plan cost right now?",
  'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
  'Is that still right?',
];

/** How close to the bottom (px) still counts as "at the bottom" for auto-scroll. */
const STICK_SLACK_PX = 96;
const COPIED_MS = 1600;

type Citation = Omit<SourceRef, 'text'>;

/** The data parts one assistant message carries, for the renderers below. */
interface MessageData {
  citations: Citation[];
  uncited: string[];
  rows: VerdictRow[];
  timings: { stage: string; ms: number }[];
}

function dataFor(message: ChatUIMessage): MessageData {
  return {
    citations: message.parts.find((part) => part.type === 'data-citations')?.data.items ?? [],
    uncited: message.parts.find((part) => part.type === 'data-flags')?.data.uncitedNumbers ?? [],
    rows: message.parts.filter((part) => part.type === 'data-verdict').map((part) => part.data.row),
    timings: message.parts.filter((part) => part.type === 'data-timing').map((part) => part.data),
  };
}

/** Renders one assistant message's parts in stream order. */
function renderAssistantParts(message: ChatUIMessage, data: MessageData): ReactNode[] {
  const rendered: ReactNode[] = [];
  let tableShown = false;
  message.parts.forEach((part, index) => {
    if (part.type === 'text') {
      rendered.push(<Markdown key={index} text={part.text} citations={data.citations} uncited={data.uncited} />);
    } else if (part.type === 'data-recall') {
      rendered.push(<RecallCard key={index} data={part.data} />);
    } else if (part.type === 'data-verdict') {
      if (!tableShown) {
        tableShown = true;
        rendered.push(<VerdictBlock key={index} rows={data.rows} />);
      }
    } else if (part.type === 'data-error') {
      rendered.push(
        <Alert key={index}>
          <span className="alert-stage">{part.data.stage}</span> {part.data.message}
        </Alert>,
      );
    }
  });
  return rendered;
}

function lastUserText(messages: ChatUIMessage[]): string {
  const last = messages.findLast((message) => message.role === 'user');
  return last === undefined ? '' : textOf(last);
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function Logo({ size, className }: { size: number; className?: string }) {
  return (
    // A 192 px copy of the logo; next/image would add nothing at these sizes.
    <img src="/minimi-logo-192.png" alt="" width={size} height={size} className={className} />
  );
}

function AnswerCard({ children }: { children: ReactNode }) {
  return (
    <article className="answer">
      <header className="answer-head">
        <Logo size={18} className="answer-logo" />
        <span>minimi</span>
      </header>
      <div className="answer-body">{children}</div>
    </article>
  );
}

export default function Page() {
  const [input, setInput] = useState('');
  const [statusLine, setStatusLine] = useState('');
  const [restored, setRestored] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const chatsButtonRef = useRef<HTMLButtonElement>(null);
  const stickRef = useRef(true);
  const copiedTimer = useRef<number | null>(null);
  const sessionRef = useRef('');
  /** Server user-turn id for the next send. Cleared as the request is built. */
  const editFromRef = useRef<string | null>(null);
  /**
   * Transcript from before an edit. While this is set, the shortened thread
   * stays on screen but is not written to storage. Cleared when the server
   * accepts the edit, or restored when it does not.
   */
  const editHoldRef = useRef<{ messages: ChatUIMessage[]; draft: string; editingId: string } | null>(null);
  /** Session whose transcript still lives only in the legacy key. */
  const legacyPendingRef = useRef<string | null>(null);
  const persistRef = useRef<(id: string, next: ChatUIMessage[]) => void>(() => {});
  const restoreEditRef = useRef<() => void>(() => {});
  // The two evals popovers in the header; opening one closes the other.
  const [panel, setPanel] = useState<'chat' | 'suite' | null>(null);
  const chatEvalsButton = useRef<HTMLButtonElement>(null);
  const suiteButton = useRef<HTMLButtonElement>(null);
  const closePanel = useCallback(() => setPanel(null), []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: '/api/chat',
        // The server keeps the history. It needs only the new message, the
        // session and the browser's zone. editFrom is set only for an in-place edit.
        prepareSendMessagesRequest: ({ messages: outgoing }) => {
          const editFrom = editFromRef.current;
          editFromRef.current = null;
          return {
            body: {
              message: lastUserText(outgoing),
              sessionId: requestSessionId(sessionRef.current, () =>
                sessionId(window.localStorage, () => crypto.randomUUID()),
              ),
              tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
              ...(editFrom !== null ? { editFrom } : {}),
            },
          };
        },
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, error, clearError } = useChat<ChatUIMessage>({
    transport,
    // Status parts are transient: they arrive here and never enter `messages`.
    onData: (part) => {
      if (part.type === 'data-status') setStatusLine(part.data.text);
    },
    onFinish: (event) => {
      if (editHoldRef.current === null) return;
      const turnId = event.message.metadata?.turnId;
      if (!editApplied({
        isAbort: event.isAbort,
        isDisconnect: event.isDisconnect,
        isError: event.isError,
        finishReason: event.finishReason,
        turnId,
      })) {
        restoreEditRef.current();
        return;
      }
      editHoldRef.current = null;
      persistRef.current(sessionRef.current, event.messages);
    },
  });

  // Compile the chat route's dependencies before the first message needs them.
  useEffect(() => {
    void fetch('/api/warm').catch(() => {});
  }, []);

  const persist = useCallback((id: string, next: ChatUIMessage[]) => {
    const store = storage();
    if (store === null || id === '') return;
    const row = snapshotChat(next, id, systemClock.now().toISOString());
    if (row === null) {
      removeChatMessages(store, id);
      return;
    }
    const updated = upsertChat(readChatIndex(store), row);
    const clearLegacy = legacyPendingRef.current === id;
    if (!persistChatRecord(store, id, next, updated, clearLegacy)) return;
    if (clearLegacy) legacyPendingRef.current = null;
    setChats(updated);
  }, []);

  function restoreEdit() {
    const hold = editHoldRef.current;
    if (hold === null) return;
    editHoldRef.current = null;
    editFromRef.current = null;
    setMessages(hold.messages);
    setEditingId(hold.editingId);
    setDraft(hold.draft);
    persist(sessionRef.current, hold.messages);
  }
  persistRef.current = persist;
  restoreEditRef.current = restoreEdit;

  // One-time: migrate the old single history, then open that chat.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 560px)');
    const applyPhone = () => setPhone(mq.matches);
    applyPhone();
    mq.addEventListener('change', applyPhone);

    const store = storage();
    if (store === null) {
      setRestored(true);
      return () => mq.removeEventListener('change', applyPhone);
    }
    let id = '';
    try {
      id = sessionId(store, () => crypto.randomUUID());
    } catch {
      id = crypto.randomUUID();
    }
    sessionRef.current = id;
    setCurrentId(id);
    setChats(applyMigration(store, id, systemClock.now().toISOString()));
    const openStored = readSidebarOpen(store);
    setSidebarOpen(openStored);
    if (mq.matches && openStored) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => sidebarRef.current?.focus());
      });
    }
    const loaded = loadSessionMessages<ChatUIMessage>(store, id);
    if (loaded.fromLegacy) legacyPendingRef.current = id;
    if (loaded.messages !== null) setMessages(loaded.messages);
    setRestored(true);
    return () => mq.removeEventListener('change', applyPhone);
  }, [setMessages]);

  useEffect(() => {
    if (!restored || !shouldWriteTranscript(editHoldRef.current !== null, status)) return;
    persist(sessionRef.current, messages);
    setStatusLine('');
  }, [restored, status, messages, persist]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setSidebarOpen(false);
      const store = storage();
      if (store !== null) writeSidebarOpen(store, false);
      window.requestAnimationFrame(() => chatsButtonRef.current?.focus());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const busy = status === 'submitted' || status === 'streaming';

  // Auto-scroll: follow new content unless the reader has scrolled up.
  useEffect(() => {
    const onScroll = () => {
      const bottom = window.innerHeight + window.scrollY;
      stickRef.current = bottom >= document.documentElement.scrollHeight - STICK_SLACK_PX;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    if (stickRef.current) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
  }, [messages, statusLine, busy, error]);

  // The list's bottom padding follows the composer's height, so the last item is never under it.
  // The sidebar sticks just below the header.
  useEffect(() => {
    const composer = composerRef.current;
    const header = headerRef.current;
    const observer = new ResizeObserver(() => {
      if (composer !== null) document.documentElement.style.setProperty('--composer-h', `${composer.offsetHeight}px`);
      if (header !== null) document.documentElement.style.setProperty('--topbar-h', `${header.offsetHeight}px`);
    });
    if (composer !== null) observer.observe(composer);
    if (header !== null) observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // The textarea grows with its text; CSS caps it at about six lines.
  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (field === null) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [input]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const focusComposer = useCallback(() => {
    const field = textareaRef.current;
    if (field === null) return;
    field.focus();
    const end = field.value.length;
    field.setSelectionRange(end, end);
    composerRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  /** Puts text into the composer, then focuses it with the cursor at the end. */
  function fillComposer(text: string) {
    setInput(text);
    window.requestAnimationFrame(focusComposer);
  }

  function send() {
    const text = input.trim();
    if (text === '' || busy) return;
    setInput('');
    stickRef.current = true;
    void sendMessage({ text });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function rememberSession(id: string) {
    const store = storage();
    if (store === null) return;
    try {
      store.setItem(SESSION_KEY, id);
    } catch {
      // The on-screen session still changes; the next reload may reopen the previous one.
    }
  }

  function newChat() {
    if (busy || !restored) return;
    persist(sessionRef.current, messages);
    const id = crypto.randomUUID();
    rememberSession(id);
    sessionRef.current = id;
    setCurrentId(id);
    setMessages([]);
    setEditingId(null);
    setDraft('');
    setInput('');
    setStatusLine('');
    clearError();
    stickRef.current = true;
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (newChatClosesSidebar(phone)) {
      setSidebarOpen(false);
      const store = storage();
      if (store !== null) writeSidebarOpen(store, false);
    }
    window.requestAnimationFrame(focusComposer);
  }

  function openChat(id: string) {
    if (busy || !restored || id === sessionRef.current) return;
    persist(sessionRef.current, messages);
    rememberSession(id);
    sessionRef.current = id;
    setCurrentId(id);
    const store = storage();
    const loaded = store === null ? null : loadSessionMessages<ChatUIMessage>(store, id);
    if (loaded?.fromLegacy) legacyPendingRef.current = id;
    setMessages(loaded?.messages ?? []);
    setEditingId(null);
    setDraft('');
    setInput('');
    setStatusLine('');
    clearError();
    stickRef.current = true;
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (newChatClosesSidebar(phone)) {
      setSidebarOpen(false);
      if (store !== null) writeSidebarOpen(store, false);
      window.requestAnimationFrame(focusComposer);
    }
  }

  function removeChat(id: string) {
    if (busy || !restored) return;
    if (!window.confirm('Delete this chat?')) return;
    const next = deleteChat(chats, id);
    const store = storage();
    if (store !== null) {
      writeChatIndex(store, next);
      removeChatMessages(store, id);
    }
    setChats(next);
    if (id !== sessionRef.current) return;
    const fresh = crypto.randomUUID();
    rememberSession(fresh);
    sessionRef.current = fresh;
    setCurrentId(fresh);
    setMessages([]);
    setEditingId(null);
    setDraft('');
    setInput('');
    setStatusLine('');
    clearError();
  }

  function toggleSidebar() {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    const store = storage();
    if (store !== null) writeSidebarOpen(store, next);
    window.requestAnimationFrame(() => {
      if (next) sidebarRef.current?.focus();
      else chatsButtonRef.current?.focus();
    });
  }

  function beginEdit(messageId: string, text: string) {
    setEditingId(messageId);
    setDraft(text);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft('');
  }

  function saveEdit() {
    if (editingId === null || busy) return;
    const text = draft.trim();
    if (text === '') return;
    const turn = groupTurns(messages).find((item) => item.user?.id === editingId);
    const fromId = editAnchor(turn?.answers ?? []);
    if (fromId === null) return;
    const kept = messagesBefore(messages, editingId);
    editHoldRef.current = { messages, draft, editingId };
    editFromRef.current = fromId;
    setEditingId(null);
    setDraft('');
    setMessages(kept);
    stickRef.current = true;
    void sendMessage({ text });
  }

  function onEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopPropagation();
      cancelEdit();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      saveEdit();
    }
  }

  function toggleTheme() {
    const root = document.documentElement;
    const current = effectiveTheme(root.getAttribute('data-theme'), window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = nextTheme(current);
    root.setAttribute('data-theme', next);
    const store = storage();
    if (store !== null) writeTheme(store, next);
  }

  function copy(id: string, text: string) {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(id);
        if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopiedId(null), COPIED_MS);
      })
      .catch(() => {});
  }

  const nowIso = systemClock.now().toISOString();
  const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
  const title = transcriptTitle(messages);
  const turns = groupTurns(messages);
  const lastTurn = turns[turns.length - 1];
  const lastAssistant = messages.findLast((message) => message.role === 'assistant');
  const lastTimings =
    lastAssistant?.parts.filter((part) => part.type === 'data-timing').map((part) => part.data) ?? [];
  const answerStarted = lastTurn !== undefined && lastTurn.answers.length > 0;
  const errorText = error ? error.message : null;
  const empty = messages.length === 0;
  const coverThread = coveredControlsInert(phone, sidebarOpen);

  return (
    <>
      <CatField />
      <div className="app">
        <Oneko />
        <header className="topbar" ref={headerRef} inert={coverThread ? true : undefined}>
          <div className="topbar-inner">
            <div className="brand">
              <Logo size={30} className="brand-logo" />
              <div className="brand-text">
                <span className="wordmark">minimi</span>
                <span className="tagline">answers that re-check themselves</span>
              </div>
            </div>
            <div className="topbar-actions">
              <button
                ref={chatsButtonRef}
                type="button"
                className="btn btn-icon"
                onClick={toggleSidebar}
                aria-label="Chats"
                title="Chats"
                aria-expanded={sidebarOpen}
                aria-controls="chat-sidebar"
              >
                <ChatsIcon />
              </button>
              <button
                ref={chatEvalsButton}
                type="button"
                className="btn btn-icon"
                onClick={() => setPanel((open) => (open === 'chat' ? null : 'chat'))}
                aria-label="This chat: evals"
                title="This chat: evals"
                aria-haspopup="dialog"
                aria-expanded={panel === 'chat'}
                aria-controls="evals-chat"
              >
                <PulseIcon />
              </button>
              <button
                ref={suiteButton}
                type="button"
                className="btn btn-icon"
                onClick={() => setPanel((open) => (open === 'suite' ? null : 'suite'))}
                aria-label="Test suite: last eval run"
                title="Test suite: last eval run"
                aria-haspopup="dialog"
                aria-expanded={panel === 'suite'}
                aria-controls="evals-suite"
              >
                <FlaskIcon />
              </button>
              <button type="button" className="btn" onClick={newChat} disabled={busy} aria-label="New chat">
                <NewChatIcon />
                <span className="btn-label">New chat</span>
              </button>
              <button
                type="button"
                className="btn btn-icon theme-toggle"
                onClick={toggleTheme}
                aria-label="Switch between light and dark theme"
                title="Switch between light and dark theme"
              >
                <span className="icon-moon">
                  <MoonIcon />
                </span>
                <span className="icon-sun">
                  <SunIcon />
                </span>
              </button>
            </div>
          </div>
        </header>

        <MenuPopover id="evals-chat" open={panel === 'chat'} anchor={chatEvalsButton} labelledBy="evals-chat-title" onClose={closePanel}>
          <ChatEvalsContent messages={messages} titleId="evals-chat-title" />
        </MenuPopover>
        <MenuPopover id="evals-suite" open={panel === 'suite'} anchor={suiteButton} labelledBy="evals-suite-title" onClose={closePanel}>
          <SuiteContent titleId="evals-suite-title" active={panel === 'suite'} />
        </MenuPopover>

        <div className="app-body">
          {phone && sidebarOpen ? (
            <button type="button" className="sidebar-scrim" aria-label="Close chats" onClick={toggleSidebar} />
          ) : null}
          <Sidebar
            open={sidebarOpen}
            chats={chats}
            currentId={currentId}
            nowIso={nowIso}
            timeZone={timeZone}
            locale={locale}
            busy={busy}
            navRef={sidebarRef}
            onNewChat={newChat}
            onOpenChat={openChat}
            onDeleteChat={removeChat}
          />
          <div className="app-column" inert={coverThread ? true : undefined}>
        <main className="thread">
          {title !== null ? <h1 className="thread-title">{title}</h1> : null}
          {empty ? (
            <section className="empty">
              {/* The hero has a soft paper backdrop, so no cat sprite sits behind its text. */}
              <div className="empty-hero">
                <Logo size={72} className="empty-logo" />
                <h1 className="empty-title">minimi</h1>
                <p className="empty-lede">
                  Ask about anything that can change. minimi searches the web, cites what it read, and can re-check an
                  earlier answer against today&rsquo;s pages.
                </p>
              </div>
              <div className="examples">
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" className="example" onClick={() => fillComposer(example)}>
                    {example}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <ol className="turns">
              {turns.map((turn, turnIndex) => {
                const isLast = turnIndex === turns.length - 1;
                const userText = turn.user === null ? '' : textOf(turn.user);
                return (
                  <li key={turn.key} className="turn">
                    {turn.user !== null ? (
                      <div className="user-row" data-role="user">
                        {editingId === turn.user.id ? (
                          <form
                            className="bubble bubble-edit"
                            onSubmit={(event) => {
                              event.preventDefault();
                              saveEdit();
                            }}
                          >
                            <textarea
                              aria-label="Edit message"
                              value={draft}
                              rows={2}
                              autoFocus
                              onChange={(event) => setDraft(event.target.value)}
                              onKeyDown={onEditKeyDown}
                            />
                            <div className="bubble-edit-actions">
                              <button type="button" className="bubble-edit-cancel" onClick={cancelEdit}>
                                Cancel
                              </button>
                              <button type="submit" className="bubble-edit-save" disabled={draft.trim() === '' || busy}>
                                Save
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="bubble-actions">
                              <button
                                type="button"
                                className="mini-btn"
                                aria-label="Edit this message"
                                title="Edit"
                                disabled={busy || editAnchor(turn.answers) === null}
                                onClick={() => beginEdit((turn.user as ChatUIMessage).id, userText)}
                              >
                                <EditIcon />
                              </button>
                              <button
                                type="button"
                                className="mini-btn"
                                aria-label={copiedId === turn.user.id ? 'Copied' : 'Copy this message'}
                                title={copiedId === turn.user.id ? 'Copied' : 'Copy'}
                                onClick={() => copy((turn.user as ChatUIMessage).id, userText)}
                              >
                                {copiedId === turn.user.id ? <CheckIcon /> : <CopyIcon />}
                                {copiedId === turn.user.id ? <span className="copied">Copied</span> : null}
                              </button>
                            </div>
                            <div className="bubble">
                              <span className="bubble-text">{userText}</span>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}

                    {turn.answers.map((answer, answerIndex) => {
                      const lastCard = isLast && answerIndex === turn.answers.length - 1;
                      return (
                        <div key={answer.id} data-role="assistant">
                          <AnswerCard>
                            {renderAssistantParts(answer, dataFor(answer))}
                            {lastCard && busy ? <StatusLine text={statusLine} /> : null}
                            {lastCard && !busy && errorText !== null ? <Alert>{errorText}</Alert> : null}
                            <Sources citations={dataFor(answer).citations} />
                          </AnswerCard>
                        </div>
                      );
                    })}

                    {isLast && !answerStarted && (busy || errorText !== null) ? (
                      <AnswerCard>
                        {busy ? <StatusLine text={statusLine} /> : null}
                        {!busy && errorText !== null ? <Alert>{errorText}</Alert> : null}
                      </AnswerCard>
                    ) : null}

                    {isLast && !busy ? <DevFooter timings={lastTimings} /> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </main>

        <div className="composer" ref={composerRef}>
          <form className="composer-form" onSubmit={onSubmit}>
            <div className="composer-box">
              <div className="composer-field">
                {input === '' ? (
                  <span className="composer-hint" aria-hidden="true">
                    Ask minimi…
                  </span>
                ) : null}
                <textarea
                  ref={textareaRef}
                  aria-label="Message"
                  autoFocus
                  rows={1}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={onKeyDown}
                />
              </div>
              <button type="submit" className="send" aria-label="Send" disabled={busy || input.trim() === ''}>
                <SendIcon />
              </button>
            </div>
          </form>
        </div>
          </div>
        </div>
      </div>
    </>
  );
}
