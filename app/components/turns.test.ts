import { describe, expect, it } from 'vitest';
import { groupTurns, textOf } from './turns';
import { hostOf } from './Sources';

const user = (id: string) => ({ id, role: 'user' as const });
const assistant = (id: string) => ({ id, role: 'assistant' as const });

describe('groupTurns', () => {
  it('pairs each user message with the answers after it', () => {
    const turns = groupTurns([user('u1'), assistant('a1'), user('u2'), assistant('a2')]);
    expect(turns.map((turn) => [turn.user?.id, turn.answers.map((answer) => answer.id)])).toEqual([
      ['u1', ['a1']],
      ['u2', ['a2']],
    ]);
  });

  it('keeps a user message that has no answer yet', () => {
    const turns = groupTurns([user('u1'), assistant('a1'), user('u2')]);
    expect(turns[1]).toEqual({ key: 'u2', user: user('u2'), answers: [] });
  });

  it('keeps an assistant message with no user message before it', () => {
    expect(groupTurns([assistant('a0'), user('u1')]).map((turn) => turn.key)).toEqual(['a0', 'u1']);
  });

  it('ignores system messages', () => {
    expect(groupTurns([{ id: 's', role: 'system' as const }])).toEqual([]);
  });
});

describe('textOf', () => {
  it('joins text parts and skips the rest', () => {
    expect(textOf({ parts: [{ type: 'text', text: 'Hello ' }, { type: 'data-status' }, { type: 'text', text: 'there' }] })).toBe(
      'Hello there',
    );
  });
});

describe('hostOf', () => {
  it('shows the host without www', () => {
    expect(hostOf('https://www.supabase.com/pricing')).toBe('supabase.com');
    expect(hostOf('not a url')).toBe('not a url');
  });
});
