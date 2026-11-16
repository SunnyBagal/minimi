'use client';

/**
 * The chat page: an input, the message list rendered from the stream's data
 * parts (recall card, cited text, verdict table, errors, timings), a status
 * line and a dev footer.
 */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { SourceRef, VerdictRow } from '../src/core/contracts';
import type { ChatUIMessage } from './api/chat/route';
import { CitedText } from './components/CitedText';
import { DevFooter } from './components/DevFooter';
import { RecallCard } from './components/RecallCard';
import { StatusLine } from './components/StatusLine';
import { VerdictTable } from './components/VerdictTable';

const SESSION_KEY = 'minimi.sessionId';
const HISTORY_KEY = 'minimi.messages';

/** The session id, created on first use and kept in localStorage. */
function sessionId(): string {
  let id = window.localStorage.getItem(SESSION_KEY);
  if (id === null) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

type Citation = Omit<SourceRef, 'text'>;

/** The data parts one assistant message carries, for the renderers below. */
interface MessageData {
  citations: Citation[];
  uncited: string[];
  rows: VerdictRow[];
  timings: { stage: string; ms: number }[];
}

/** Renders one assistant message's parts in stream order. */
function renderAssistantParts(message: ChatUIMessage, data: MessageData): ReactNode[] {
  const rendered: ReactNode[] = [];
  let tableShown = false;
  message.parts.forEach((part, index) => {
    if (part.type === 'text') {
      rendered.push(<CitedText key={index} text={part.text} citations={data.citations} uncited={data.uncited} />);
    } else if (part.type === 'data-recall') {
      rendered.push(<RecallCard key={index} data={part.data} />);
    } else if (part.type === 'data-verdict') {
      if (!tableShown) {
        tableShown = true;
        rendered.push(<VerdictTable key={index} rows={data.rows} />);
      }
    } else if (part.type === 'data-error') {
      rendered.push(
        <em key={index} role="alert">
          {' '}
          [{part.data.stage}] {part.data.message}
        </em>,
      );
    }
  });
  return rendered;
}

function lastUserText(messages: ChatUIMessage[]): string {
  const last = messages.findLast((message) => message.role === 'user');
  if (last === undefined) return '';
  return last.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

export default function Page() {
  const [input, setInput] = useState('');
  const [statusLine, setStatusLine] = useState('');
  const [restored, setRestored] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: '/api/chat',
        // The server keeps the history. It needs only the new message, the
        // session and the browser's zone.
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            message: lastUserText(messages),
            sessionId: sessionId(),
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        }),
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, error } = useChat<ChatUIMessage>({
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
  const lastAssistant = messages.findLast((message) => message.role === 'assistant');
  const lastTimings =
    lastAssistant?.parts
      .filter((part) => part.type === 'data-timing')
      .map((part) => part.data) ?? [];

  function dataFor(message: ChatUIMessage): MessageData {
    return {
      citations:
        message.parts.find((part) => part.type === 'data-citations')?.data.items ?? [],
      uncited: message.parts.find((part) => part.type === 'data-flags')?.data.uncitedNumbers ?? [],
      rows: message.parts.filter((part) => part.type === 'data-verdict').map((part) => part.data.row),
      timings: message.parts.filter((part) => part.type === 'data-timing').map((part) => part.data),
    };
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (text === '' || busy) return;
    setInput('');
    void sendMessage({ text });
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>minimi</h1>

      <ol style={{ listStyle: 'none', padding: 0 }}>
        {messages.map((message) => (
          <li key={message.id} data-role={message.role} style={{ margin: '12px 0', whiteSpace: 'pre-wrap' }}>
            <strong>{message.role === 'user' ? 'You' : 'Agent'}: </strong>
            {message.role === 'user'
              ? message.parts.map((part, index) => (part.type === 'text' ? <span key={index}>{part.text}</span> : null))
              : renderAssistantParts(message, dataFor(message))}
          </li>
        ))}
      </ol>

      <StatusLine text={busy ? statusLine : ''} error={error ? error.message : null} />
      <DevFooter timings={lastTimings} />

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          aria-label="Message"
          autoFocus
          value={input}
          onChange={(event) => setInput(event.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={busy || input.trim() === ''}>
          Send
        </button>
      </form>
    </main>
  );
}
