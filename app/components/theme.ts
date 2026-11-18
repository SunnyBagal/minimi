/**
 * Light/dark theme choice. Before the user chooses, the page follows
 * `prefers-color-scheme` (no `data-theme` on <html>). After a choice, the
 * attribute is set and remembered under THEME_KEY.
 */

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'minimi.theme';

/** The smallest storage surface the helpers need, so tests can pass a Map-backed fake. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

/** The other theme. */
export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}

/** The theme on screen: the stored choice if there is a valid one, else the system preference. */
export function effectiveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (isTheme(stored)) return stored;
  return prefersDark ? 'dark' : 'light';
}

/** The stored choice, or null when there is none, it is invalid, or storage throws. */
export function readTheme(storage: ThemeStorage): Theme | null {
  try {
    const value = storage.getItem(THEME_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the choice. Returns false when storage throws (private mode, blocked site data). */
export function writeTheme(storage: ThemeStorage, theme: Theme): boolean {
  try {
    storage.setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs in <head> before first paint. It reads only THEME_KEY and sets
 * `data-theme` when a valid choice is stored; otherwise CSS follows the system.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=window.localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
