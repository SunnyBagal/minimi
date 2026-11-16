import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rig, SESSION, textOf, types } from './testSupport';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('runTurn', () => {
  it('event order: chat', async () => {
    const { run } = rig({ llm: { write: ['Hel', 'lo'] } });
    const events = await run({ message: 'hello' });
    expect(types(events, ['timing'])).toEqual(['status', 'text', 'text', 'done']);
    expect(textOf(events)).toBe('Hello');
  });

  it('saves both turns', async () => {
    const { run, store } = rig({ llm: { write: ['hi'] }, now: '2026-11-10T20:00:00.000Z' });
    await run({ sessionId: 's1', message: 'remember me' });
    const turns = store.allTurns();
    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(turns[0]?.content).toBe('remember me');
    expect(turns[1]?.content).toBe('hi');
    for (const turn of turns) {
      expect(turn.sessionId).toBe('s1');
      expect(turn.tz).toBe('Asia/Kolkata');
      expect(turn.origin).toBe('live');
    }
    expect(turns[0]?.intent).toBeNull();
    expect(turns[1]?.intent).toBe('chat');
  });

  it('marks both turns origin seed when input.origin is seed', async () => {
    const { run, store } = rig({});
    await run({ origin: 'seed', message: 'seeded' });
    expect(store.allTurns().map((turn) => turn.origin)).toEqual(['seed', 'seed']);
  });

  it('recent never holds the current message', async () => {
    const { run, store } = rig({ llm: { write: ['first answer'] } });
    await run({ message: 'first question' });
    const { run: run2, llm: llm2 } = rig({ store });
    await run2({ message: 'second question' });
    const firstIds = store.allTurns().slice(0, 2).map((turn) => turn.id);
    const routeRecent = llm2.calls('route')[0]?.input.recent ?? [];
    expect(routeRecent.map((turn) => turn.id)).toEqual(firstIds);
    expect(routeRecent.map((turn) => turn.content)).not.toContain('second question');
  });

  it('a writer error gives an error event then done, and the turn is saved', async () => {
    const { run, store } = rig({
      llm: {
        write: () => {
          async function* fail(): AsyncIterable<string> {
            yield 'partial';
            throw new Error('model exploded');
          }
          return fail();
        },
      },
    });
    const events = await run({ message: 'hi' });
    expect(types(events).slice(-2)).toEqual(['error', 'done']);
    const error = events.find((event) => event.type === 'error');
    if (error === undefined || error.type !== 'error') throw new Error('no error event');
    expect(error.stage).toBe('write');
    const assistant = store.allTurns().find((turn) => turn.role === 'assistant');
    expect(assistant?.content).toBe('partial');
  });

  it('a router error still ends with done and a saved assistant turn', async () => {
    const { run, store } = rig({ llm: { route: () => Promise.reject(new Error('router down')) } });
    const events = await run({ message: 'hi' });
    expect(types(events).at(-1)).toBe('done');
    expect(store.allTurns().filter((turn) => turn.role === 'assistant')).toHaveLength(1);
  });

  it('no pipeline file imports src/core/time or ./guards', () => {
    const result = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'check-imports.mjs'), REPO_ROOT], {
      encoding: 'utf8',
    });
    expect(result.stdout.trim()).toBe('check-imports: ok');
    expect(result.status).toBe(0);
  });

  it('uses the caller session id on both turns', async () => {
    const { run, store } = rig({});
    await run({ message: 'hi' });
    expect(store.allTurns().every((turn) => turn.sessionId === SESSION)).toBe(true);
  });
});
