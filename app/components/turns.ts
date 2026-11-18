/** Groups a flat message list into turns: one user message and the answers that follow it. */

interface RoleMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
}

export interface Turn<M extends RoleMessage> {
  key: string;
  user: M | null;
  answers: M[];
}

export function groupTurns<M extends RoleMessage>(messages: M[]): Turn<M>[] {
  const turns: Turn<M>[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ key: message.id, user: message, answers: [] });
    } else if (message.role === 'assistant') {
      const last = turns[turns.length - 1];
      if (last === undefined) turns.push({ key: message.id, user: null, answers: [message] });
      else last.answers.push(message);
    }
  }
  return turns;
}

/** The plain text of a message's text parts. */
export function textOf(message: { parts: ReadonlyArray<{ type: string; text?: unknown }> }): string {
  return message.parts.map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('');
}
