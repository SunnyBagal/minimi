import { describe, expect, it } from 'vitest';
import { pool } from './pool';

describe('pool', () => {
  it('runs at most `limit` tasks at once', async () => {
    let running = 0;
    let peak = 0;
    const results: number[] = [];
    const work = async (n: number) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 - Math.min(n, 4)));
      running -= 1;
      return n;
    };
    for await (const value of pool([0, 1, 2, 3, 4, 5], 2, work)) results.push(value);
    expect(peak).toBe(2);
    expect([...results].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('yields results in completion order', async () => {
    const items = [0, 1, 2];
    const seen: string[] = [];
    // Item 0 finishes last, item 2 first: real async work, so resolution
    // order (not registration order) decides what is yielded next.
    for await (const value of pool(items, 3, (n) => new Promise<string>((r) => setTimeout(() => r(`item ${n}`), (2 - n) * 5)))) {
      seen.push(value);
    }
    expect(seen).toEqual(['item 2', 'item 1', 'item 0']);
  });

  it('a limit of 0 still yields every result', async () => {
    const seen: number[] = [];
    for await (const value of pool([1, 2, 3], 0, async (n) => n)) seen.push(value);
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('yields every result', async () => {
    const seen: number[] = [];
    for await (const value of pool([1, 2, 3], 10, async (n) => n * 2)) seen.push(value);
    expect([...seen].sort()).toEqual([2, 4, 6]);
  });

  it('rethrows the first rejection', async () => {
    const seen: number[] = [];
    await expect(async () => {
      for await (const value of pool([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      })) {
        seen.push(value);
      }
    }).rejects.toThrow('boom');
  });
});
