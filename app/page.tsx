'use client';

/**
 * Lane 0 page: an input, the message list and one status line. Lane 5 builds
 * the real UI on top of the data parts that the chat route already sends.
 */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ChatUIMessage } from './api/chat/route';

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
            {message.parts.map((part, index) => {
              if (part.type === 'text') return <span key={index}>{part.text}</span>;
              if (part.type === 'data-error') {
                return (
                  <em key={index} role="alert">
                    {' '}
                    [{part.data.stage}] {part.data.message}
                  </em>
                );
              }
              return null;
            })}
          </li>
        ))}
      </ol>

      <p aria-live="polite" data-testid="status" style={{ minHeight: 20, color: '#555' }}>
        {error ? `Error: ${error.message}` : busy ? statusLine : ''}
      </p>

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
