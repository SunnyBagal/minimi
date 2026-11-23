import { describe, expect, it } from 'vitest';
import { forgetChatOnServer } from './forgetChat';

describe('forgetChatOnServer', () => {
  it('sends DELETE /api/chat with the session id and reports success', async () => {
    const calls: [string, RequestInit][] = [];
    const ok = await forgetChatOnServer('session-1', async (input, init) => {
      calls.push([input, init]);
      return Response.json({ forgotten: 2 });
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('/api/chat');
    expect(calls[0]?.[1].method).toBe('DELETE');
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({ sessionId: 'session-1' });
  });

  it('reports failure on an error status or a network error, so the chat is kept', async () => {
    expect(await forgetChatOnServer('s', async () => new Response(null, { status: 500 }))).toBe(false);
    expect(
      await forgetChatOnServer('s', async () => {
        throw new Error('offline');
      }),
    ).toBe(false);
  });
});
