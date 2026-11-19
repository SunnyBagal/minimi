/** The chat list. Open and closed is the page's job; this is the list itself. */
import type { Ref } from 'react';
import { relativeDay, type ChatRow } from './chats';
import { NewChatIcon, TrashIcon } from './icons';

export function Sidebar({
  open,
  chats,
  currentId,
  nowIso,
  timeZone,
  busy,
  navRef,
  onNewChat,
  onOpenChat,
  onDeleteChat,
}: {
  open: boolean;
  chats: readonly ChatRow[];
  currentId: string;
  nowIso: string;
  timeZone: string;
  busy: boolean;
  navRef: Ref<HTMLElement>;
  onNewChat: () => void;
  onOpenChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
}) {
  return (
    <aside id="chat-sidebar" ref={navRef} className="sidebar" hidden={!open} tabIndex={-1} aria-label="Chats">
      <button type="button" className="sidebar-new" onClick={onNewChat} disabled={busy}>
        <NewChatIcon />
        <span>New chat</span>
      </button>
      {chats.length === 0 ? <p className="sidebar-empty">No chats yet</p> : null}
      <ul className="sidebar-list">
        {chats.map((chat) => {
          const current = chat.id === currentId;
          return (
            <li key={chat.id}>
              <div className={current ? 'sidebar-row current' : 'sidebar-row'}>
                <button
                  type="button"
                  className="sidebar-open"
                  aria-current={current ? 'true' : undefined}
                  onClick={() => onOpenChat(chat.id)}
                >
                  <span className="sidebar-title">{chat.title}</span>
                  <span className="sidebar-day">{relativeDay(chat.updatedAt, nowIso, timeZone)}</span>
                </button>
                <button
                  type="button"
                  className="sidebar-delete"
                  aria-label={`Delete ${chat.title}`}
                  title="Delete"
                  disabled={busy}
                  onClick={() => onDeleteChat(chat.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
