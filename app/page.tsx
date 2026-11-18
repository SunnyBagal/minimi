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
import type { ChatUIMessage } from './api/chat/route';
import { CatField } from './components/CatField';
import { DevFooter } from './components/DevFooter';
import { CheckIcon, CopyIcon, EditIcon, MoonIcon, NewChatIcon, SendIcon, SunIcon } from './components/icons';
import { Markdown } from './components/Markdown';
import { RecallCard } from './components/RecallCard';
import { HISTORY_KEY, resetSession, sessionId } from './components/session';
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const copiedTimer = useRef<number | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: '/api/chat',
        // The server keeps the history. It needs only the new message, the
        // session and the browser's zone.
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            message: lastUserText(messages),
            sessionId: sessionId(window.localStorage, () => crypto.randomUUID()),
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, error, clearError } = useChat<ChatUIMessage>({
    transport,
    // Status parts are transient: they arrive here and never enter `messages`.
    onData: (part) => {
      if (part.type === 'data-status') setStatusLine(part.data.text);
    },
  });

  // Compile the chat route's dependencies before the first message needs them.
  useEffect(() => {
    void fetch('/api/warm').catch(() => {});
  }, []);

  // Message history survives a reload. Only what is in `messages` is saved.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(HISTORY_KEY);
      if (saved !== null) setMessages(JSON.parse(saved) as ChatUIMessage[]);
    } catch {
      window.localStorage.removeItem(HISTORY_KEY);
    }
    setRestored(true);
  }, [setMessages]);

  useEffect(() => {
    if (!restored || status === 'submitted' || status === 'streaming') return;
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(messages));
    setStatusLine('');
  }, [restored, status, messages]);

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
  useEffect(() => {
    const composer = composerRef.current;
    if (composer === null) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--composer-h', `${composer.offsetHeight}px`);
    });
    observer.observe(composer);
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

  function newChat() {
    if (busy) return;
    const store = storage();
    if (store !== null) {
      try {
        resetSession(store, crypto.randomUUID());
      } catch {
        // Storage refused the write; the on-screen reset still happens.
      }
    }
    setMessages([]);
    setInput('');
    setStatusLine('');
    clearError();
    stickRef.current = true;
    window.scrollTo({ top: 0, behavior: 'auto' });
    window.requestAnimationFrame(focusComposer);
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

  const turns = groupTurns(messages);
  const lastTurn = turns[turns.length - 1];
  const lastAssistant = messages.findLast((message) => message.role === 'assistant');
  const lastTimings =
    lastAssistant?.parts.filter((part) => part.type === 'data-timing').map((part) => part.data) ?? [];
  const answerStarted = lastTurn !== undefined && lastTurn.answers.length > 0;
  const errorText = error ? error.message : null;
  const empty = messages.length === 0;

  return (
    <>
      <CatField />
      <div className="app">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="brand">
              <Logo size={30} className="brand-logo" />
              <div className="brand-text">
                <span className="wordmark">minimi</span>
                <span className="tagline">answers that re-check themselves</span>
              </div>
            </div>
            <div className="topbar-actions">
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

        <main className="thread">
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
                        <div className="bubble-actions">
                          <button
                            type="button"
                            className="mini-btn"
                            aria-label="Edit this message"
                            title="Edit"
                            disabled={busy}
                            onClick={() => fillComposer(userText)}
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
                        <div className="bubble">{userText}</div>
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
            <p className="composer-note">Enter to send · Shift+Enter for a new line</p>
          </form>
        </div>
      </div>
    </>
  );
}
