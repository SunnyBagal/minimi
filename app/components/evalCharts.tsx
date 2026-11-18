'use client';

/**
 * Hand-built SVG and CSS charts for the evals popovers. Every chart has a title (its row
 * or label), an accessible name that states its values, values printed next to the
 * marks, and a text label beside every colour. Colours and sizes are in globals.css
 * (.mb-*); the palette was checked with the dataviz skill's validator (see the handoff).
 */
import type { ReactNode } from 'react';
import { ChevronIcon } from './icons';

/** A share as a CSS width, clamped to 0–100 %. */
const pct = (share: number) => `${Math.min(100, Math.max(0, share * 100))}%`;

/** The macOS brightness-slider look, for a headline ratio. Null shows an empty track and the reason. */
export function SliderMeter({
  label,
  share,
  valueText,
  left,
  right,
  caption,
}: {
  label: string;
  share: number | null;
  valueText: string;
  left: ReactNode;
  right: ReactNode;
  caption: string;
}) {
  return (
    <div className="mb-slider-block">
      <div className="mb-slider-head">
        <span className="mb-label">{label}</span>
        <span className="mb-value">{valueText}</span>
      </div>
      <div
        className="mb-slider"
        role="meter"
        aria-label={`${label}: ${share === null ? 'no data' : valueText}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={share === null ? undefined : Math.round(share * 100)}
        aria-valuetext={share === null ? 'no data' : valueText}
      >
        {share !== null ? <span className="mb-slider-fill" style={{ width: `max(24px, ${pct(share)})` }} /> : null}
        <span className="mb-slider-icon mb-slider-left">{left}</span>
        <span className="mb-slider-icon mb-slider-right">{right}</span>
      </div>
      <p className="mb-caption">{caption}</p>
    </div>
  );
}

/** A round tile like the Control Centre toggles: a ring for a share (or none), an icon, label and value below. */
export function RingTile({
  label,
  share,
  valueText,
  icon,
  reason,
}: {
  label: string;
  share: number | null;
  valueText: string;
  icon: ReactNode;
  /** Why there is no value; shown under "—". */
  reason?: string;
}) {
  const r = 21;
  const length = 2 * Math.PI * r;
  return (
    <figure className="mb-tile-round" aria-label={`${label}: ${valueText === '—' ? `no data${reason ? `, ${reason}` : ''}` : valueText}`}>
      <span className="mb-round">
        <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
          {share !== null ? (
            <>
              <circle className="mb-ring-track" cx="24" cy="24" r={r} />
              <circle
                className="mb-ring-fill"
                cx="24"
                cy="24"
                r={r}
                strokeDasharray={`${length * Math.min(1, Math.max(0, share))} ${length}`}
                transform="rotate(-90 24 24)"
              />
            </>
          ) : null}
        </svg>
        <span className="mb-round-icon">{icon}</span>
      </span>
      <figcaption>
        <span className="mb-round-label">{label}</span>
        <span className="mb-round-value">{valueText}</span>
        {valueText === '—' && reason ? <span className="mb-round-reason">{reason}</span> : null}
      </figcaption>
    </figure>
  );
}

/** One expandable row: round icon, title, a short summary, chevron. Native <details>. */
export function MenuRow({ icon, title, summary, children }: { icon: ReactNode; title: string; summary: string; children: ReactNode }) {
  return (
    <details className="mb-row">
      <summary>
        <span className="mb-row-icon">{icon}</span>
        <span className="mb-row-title">{title}</span>
        <span className="mb-row-summary">{summary}</span>
        <span className="mb-row-chevron">
          <ChevronIcon />
        </span>
      </summary>
      <div className="mb-row-body">{children}</div>
    </details>
  );
}

export interface Segment {
  key: string;
  label: ReactNode;
  /** Plain text for the accessible name. */
  name: string;
  value: number;
  /** A CSS colour, e.g. var(--viz-1). */
  color: string;
}

/** One whole split into parts: a thin segmented bar with 2 px gaps, and a legend with counts and shares. */
export function SegmentedBar({ title, segments, unit }: { title: string; segments: Segment[]; unit: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const share = (value: number) => (total === 0 ? 0 : value / total);
  const name = `${title}: ${segments.map((s) => `${s.name} ${s.value} (${Math.round(share(s.value) * 100)}%)`).join(', ')}`;
  return (
    <div className="mb-chart">
      <p className="mb-chart-title">{title}</p>
      <div className="mb-seg" role="img" aria-label={name}>
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span
              key={segment.key}
              className="mb-seg-part"
              style={{ flexGrow: segment.value, background: segment.color }}
              title={`${segment.name}: ${segment.value} ${unit}`}
            />
          ))}
      </div>
      <ul className="mb-legend">
        {segments.map((segment) => (
          <li key={segment.key}>
            <span className="mb-swatch" style={{ background: segment.color }} aria-hidden="true" />
            <span className="mb-legend-label">{segment.label}</span>
            <span className="mb-legend-value">
              {segment.value} · {Math.round(share(segment.value) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars, one per row, value printed at the tip. One series, so no legend. */
export function HBars({ title, rows, format }: { title: string; rows: { label: string; value: number }[]; format: (value: number) => string }) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  return (
    <div className="mb-chart">
      <p className="mb-chart-title">{title}</p>
      <ul className="mb-hbars" aria-label={`${title}: ${rows.map((row) => `${row.label} ${format(row.value)}`).join(', ')}`}>
        {rows.map((row) => (
          <li key={row.label}>
            <span className="mb-hbar-label">{row.label}</span>
            <span className="mb-hbar-track" aria-hidden="true">
              <span className="mb-hbar" style={{ width: max === 0 ? 0 : pct(row.value / max) }} />
            </span>
            <span className="mb-hbar-value">{format(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A sparkline of values in order, from a zero baseline, with the last value labelled. */
export function Sparkline({ title, values, format }: { title: string; values: number[]; format: (value: number) => string }) {
  const width = 240;
  const height = 44;
  const pad = 6;
  const max = Math.max(...values, 0);
  const x = (i: number) => (values.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (values.length - 1));
  const y = (v: number) => (max === 0 ? height - pad : height - pad - (v / max) * (height - 2 * pad));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <div className="mb-chart">
      <p className="mb-chart-title">{title}</p>
      <div className="mb-spark-wrap">
        <svg
          className="mb-spark"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}: ${values.map(format).join(', ')}`}
        >
          <line className="mb-spark-base" x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} />
          {values.length > 1 ? <polyline className="mb-spark-line" points={points} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {last >= 0 ? (
          <span
            className="mb-spark-dot"
            style={{ left: `${(x(last) / width) * 100}%`, top: `${(y(values[last] as number) / height) * 100}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <p className="mb-caption">
        {values.length} {values.length === 1 ? 'answer' : 'answers'}
        {last >= 0 ? ` · last ${format(values[last] as number)} · highest ${format(max)}` : ''}
      </p>
    </div>
  );
}
