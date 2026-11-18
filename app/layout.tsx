import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { THEME_INIT_SCRIPT } from './components/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'minimi',
  description: 'A chat agent that can re-check what it told you.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f4f0' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d0e' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The pre-paint script may set data-theme before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* A fixed string from theme.ts; it reads only the theme key, so the first paint has the right theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
