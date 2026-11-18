import { describe, expect, it } from 'vitest';
import { effectiveTheme, nextTheme, readTheme, THEME_INIT_SCRIPT, THEME_KEY, writeTheme, type ThemeStorage } from './theme';

function memory(initial: Record<string, string> = {}): ThemeStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const throwing: ThemeStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('theme choice', () => {
  it('nextTheme toggles between light and dark', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme(nextTheme('light'))).toBe('light');
  });

  it('follows the system preference before the user has chosen', () => {
    expect(effectiveTheme(null, true)).toBe('dark');
    expect(effectiveTheme(null, false)).toBe('light');
  });

  it('a stored choice wins over the system preference', () => {
    expect(effectiveTheme('light', true)).toBe('light');
    expect(effectiveTheme('dark', false)).toBe('dark');
  });

  it('ignores an invalid stored value', () => {
    expect(effectiveTheme('purple', true)).toBe('dark');
    expect(readTheme(memory({ [THEME_KEY]: 'purple' }))).toBeNull();
  });

  it('remembers the choice under one key and reads it back', () => {
    const storage = memory();
    expect(readTheme(storage)).toBeNull();
    expect(writeTheme(storage, 'dark')).toBe(true);
    expect(storage.data.get(THEME_KEY)).toBe('dark');
    expect(readTheme(storage)).toBe('dark');
    expect([...storage.data.keys()]).toEqual([THEME_KEY]);
  });

  it('survives storage that throws', () => {
    expect(readTheme(throwing)).toBeNull();
    expect(writeTheme(throwing, 'light')).toBe(false);
  });

  it('the pre-paint script reads only the theme key and sets data-theme only for a valid value', () => {
    const keys = [...THEME_INIT_SCRIPT.matchAll(/getItem\(([^)]*)\)/g)].map((match) => match[1]);
    expect(keys).toEqual([JSON.stringify(THEME_KEY)]);
    expect(THEME_INIT_SCRIPT).not.toContain('setItem');
    expect(THEME_INIT_SCRIPT).toContain("setAttribute('data-theme',t)");

    for (const [stored, expected] of [
      ['dark', 'dark'],
      ['light', 'light'],
      ['purple', null],
      [null, null],
    ] as const) {
      const attributes = new Map<string, string>();
      const fakeWindow = { localStorage: { getItem: (key: string) => (key === THEME_KEY ? stored : null) } };
      const fakeDocument = { documentElement: { setAttribute: (name: string, value: string) => void attributes.set(name, value) } };
      new Function('window', 'document', THEME_INIT_SCRIPT)(fakeWindow, fakeDocument);
      expect(attributes.get('data-theme') ?? null).toBe(expected);
    }
  });

  it('the pre-paint script does not throw when storage is blocked', () => {
    const fakeWindow = {
      get localStorage(): never {
        throw new Error('SecurityError');
      },
    };
    expect(() => new Function('window', 'document', THEME_INIT_SCRIPT)(fakeWindow, {})).not.toThrow();
  });
});
