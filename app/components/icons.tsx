/** Inline SVG icons. Decorative: the buttons that hold them carry the label. */
import type { ReactNode } from 'react';

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function SendIcon() {
  return (
    <Icon>
      <path d="M12 19V5" />
      <path d="M5.5 11.5 12 5l6.5 6.5" />
    </Icon>
  );
}

export function NewChatIcon() {
  return (
    <Icon size={16}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function SunIcon() {
  return (
    <Icon size={17}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </Icon>
  );
}

export function MoonIcon() {
  return (
    <Icon size={17}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </Icon>
  );
}

export function EditIcon() {
  return (
    <Icon size={15}>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </Icon>
  );
}

export function CopyIcon() {
  return (
    <Icon size={15}>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon size={15}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

/* ---- ui-r3: evals popovers ---- */

export function PulseIcon({ size = 17 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </Icon>
  );
}

export function FlaskIcon({ size = 17 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M9.5 3.5h5" />
      <path d="M10.5 3.5v6L5 19a1.3 1.3 0 0 0 1.1 2h11.8a1.3 1.3 0 0 0 1.1-2l-5.5-9.5v-6" />
      <path d="M7.5 15h9" />
    </Icon>
  );
}

export function ChevronIcon({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function ShieldCheckIcon({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6l-7-2.5Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Icon>
  );
}

export function GlobeIcon({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5Z" />
    </Icon>
  );
}

export function ClockIcon({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function QuoteIcon({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M5 18h14M5 13h14M5 8h9" />
    </Icon>
  );
}

export function CheckCircleIcon({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.3 2.3 4.7-4.7" />
    </Icon>
  );
}

export function XCircleIcon({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
    </Icon>
  );
}

export function StackIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="3.5" y="9" width="17" height="6" rx="3" />
      <path d="M9 9v6M14.5 9v6" />
    </Icon>
  );
}

export function BarsIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 6h10M4 12h16M4 18h7" />
    </Icon>
  );
}

export function LinkIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Icon>
  );
}

export function AlertIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 4 2.8 19.5h18.4L12 4Z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </Icon>
  );
}

export function GridIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </Icon>
  );
}

export function CoinIcon({ size = 16 }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.4 5 4.1 0 1.1-1 2-2.5 2-1.2 0-2.1-.5-2.6-1.3M12 6.5V8M12 16v1.5" />
    </Icon>
  );
}

export function ChatsIcon() {
  return (
    <Icon size={16}>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M9 4v16" />
    </Icon>
  );
}

export function TrashIcon() {
  return (
    <Icon size={15}>
      <path d="M5 7h14" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M7 7l1 12.5h8L17 7" />
    </Icon>
  );
}

export function TerminalIcon({ size = 15 }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="m7.5 10 2.5 2-2.5 2M12.5 14.5h4" />
    </Icon>
  );
}
