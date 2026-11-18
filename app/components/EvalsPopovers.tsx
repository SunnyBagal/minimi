'use client';

/**
 * The contents of the two header popovers: "This chat" (figures from the messages on
 * screen, chatEvals.ts) and "Test suite" (the last scripted eval run, /api/evals). Every
 * figure comes from that data; a figure with no data shows "—" and says why.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Verdict } from '../../src/core/contracts';
import type { ChatUIMessage } from '../api/chat/route';
import type { EvalSummary } from '../api/evals/summary';
import { chatEvals, chatSubtitle, coverageCaption, duration, INTENTS, percent, VERDICTS } from './chatEvals';
import { HBars, MenuRow, RingTile, SegmentedBar, Sparkline, SliderMeter } from './evalCharts';
import {
  AlertIcon,
  BarsIcon,
  CheckCircleIcon,
  ChevronIcon,
  ClockIcon,
  CoinIcon,
  CopyIcon,
  FlaskIcon,
  GlobeIcon,
  GridIcon,
  LinkIcon,
  PulseIcon,
  QuoteIcon,
  ShieldCheckIcon,
  StackIcon,
  TerminalIcon,
  XCircleIcon,
} from './icons';
import { heldoutView, STATUS_LABEL, suiteView, usd, type CaseCell, type LoadedSet } from './suiteEvals';

export const SUITE_COMMAND = 'npm run evals -- --runs 3';
/** How long the copy button says "Copied". */
const COPIED_MS = 1500;

function HeadTile({
  id,
  icon,
  title,
  subtitle,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className="mb-head-icon">{icon}</span>
      <span className="mb-head-text">
        <span className="mb-head-title" id={id}>
          {title}
        </span>
        <span className="mb-head-sub">{subtitle}</span>
      </span>
    </>
  );
  if (children === undefined) return <div className="mb-head mb-head-plain">{body}</div>;
  return (
    <details className="mb-head">
      <summary>
        {body}
        <span className="mb-row-chevron">
          <ChevronIcon />
        </span>
      </summary>
      <div className="mb-head-details">{children}</div>
    </details>
  );
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="mb-facts">
      {items.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const VERDICT_LABEL: Record<Verdict, string> = {
  unchanged: 'Unchanged',
  changed: 'Changed',
  unverifiable: 'Unverifiable',
  source_unavailable: 'Source unavailable',
};
const VERDICT_PILL: Record<Verdict, string> = {
  unchanged: 'pill pill-unchanged',
  changed: 'pill pill-changed',
  unverifiable: 'pill pill-unverifiable',
  source_unavailable: 'pill pill-source_unavailable',
};
const VERDICT_COLOR: Record<Verdict, string> = {
  unchanged: 'var(--viz-unchanged)',
  changed: 'var(--viz-changed)',
  unverifiable: 'var(--viz-unverifiable)',
  source_unavailable: 'var(--viz-unavailable)',
};
const INTENT_LABEL = {
  fresh: 'Fresh (searched)',
  recheck: 'Re-checks',
  recall: 'Recalls',
  chat: 'Chat',
} as const;

export function ChatEvalsContent({ messages, titleId }: { messages: ChatUIMessage[]; titleId: string }) {
  const evals = useMemo(() => chatEvals(messages), [messages]);
  const { coverage, sources, verdicts, latency } = evals;
  const running =
    latency.inProgress === 0
      ? null
      : `${latency.inProgress} ${latency.inProgress === 1 ? 'turn is' : 'turns are'} still running and not counted`;

  return (
    <>
      <HeadTile id={titleId} icon={<PulseIcon size={18} />} title="This chat" subtitle={chatSubtitle(evals)}>
        <Facts
          items={[
            ['Answers', String(evals.answers)],
            ...(evals.intents === null
              ? []
              : INTENTS.map((intent): [string, ReactNode] => [
                  INTENT_LABEL[intent],
                  String(evals.intents?.[intent] ?? 0),
                ])),
            ...(evals.intents !== null && evals.answersWithoutIntent > 0
              ? [['Without an intent yet', String(evals.answersWithoutIntent)] as [string, ReactNode]]
              : []),
            ['Validated answers', String(coverage.validated)],
            ['Awaiting validation', String(coverage.pending)],
            ['Uncited numbers flagged', String(coverage.uncitedNumbers)],
            ['Errors', String(evals.errors)],
          ]}
        />
        <p className="mb-note">
          Counted from the answers on screen; nothing here is scored by a model. Citation coverage uses the
          validator&rsquo;s flags, which do not ask for a citation on numbers taken from your own question.
        </p>
      </HeadTile>

      <SliderMeter
        label="Citation coverage"
        share={coverage.share}
        valueText={percent(coverage.share)}
        left={<QuoteIcon />}
        right={<CheckCircleIcon />}
        caption={coverageCaption(evals)}
      />

      <div className="mb-tiles">
        <RingTile
          label="Verified now"
          share={verdicts.verifiedShare}
          valueText={percent(verdicts.verifiedShare)}
          icon={<ShieldCheckIcon />}
          reason="no re-check yet"
        />
        <RingTile
          label="Live sources"
          share={sources.liveShare}
          valueText={percent(sources.liveShare)}
          icon={<GlobeIcon />}
          reason="no sources yet"
        />
        <RingTile
          label="Avg. answer"
          share={null}
          valueText={latency.avgAnswerMs === null ? '—' : `${(latency.avgAnswerMs / 1000).toFixed(1)} s`}
          icon={<ClockIcon />}
          reason={latency.inProgress > 0 ? 'first answer still running' : 'no finished answer yet'}
        />
      </div>

      <hr className="mb-divider" />
      <h3 className="mb-section">Details</h3>

      <MenuRow
        icon={<StackIcon />}
        title="Verdicts"
        summary={verdicts.rows === 0 ? '—' : `${verdicts.rows} ${verdicts.rows === 1 ? 'row' : 'rows'}`}
      >
        {verdicts.rows === 0 ? (
          <p className="mb-empty">No re-check in this chat yet, so there are no verdict rows.</p>
        ) : (
          <>
            <SegmentedBar
              title="Verdict per claim"
              unit="rows"
              segments={VERDICTS.map((verdict) => ({
                key: verdict,
                name: VERDICT_LABEL[verdict],
                label: <span className={VERDICT_PILL[verdict]}>{VERDICT_LABEL[verdict]}</span>,
                value: verdicts.counts[verdict],
                color: VERDICT_COLOR[verdict],
              }))}
            />
            <p className="mb-caption">
              Verified now: {verdicts.verifiedNow} of {verdicts.rows} rows were checked against a page fetched for this
              re-check.
            </p>
          </>
        )}
      </MenuRow>

      <MenuRow
        icon={<BarsIcon />}
        title="Latency by stage"
        summary={latency.avgAnswerMs === null ? '—' : `avg ${duration(latency.avgAnswerMs)}`}
      >
        {latency.stages.length === 0 ? (
          <p className="mb-empty">No stage timings have arrived yet.</p>
        ) : (
          <>
            <HBars
              title="Average per stage, every turn so far"
              rows={latency.stages.map((s) => ({
                label: s.stage,
                value: s.avgMs,
              }))}
              format={duration}
            />
            {latency.perAnswer.length === 0 ? (
              <p className="mb-empty">
                No answer has finished yet, so there is no total per answer{running === null ? '' : `; ${running}`}.
              </p>
            ) : (
              <>
                <Sparkline title="Total time per finished answer" values={latency.perAnswer} format={duration} />
                {running === null ? null : <p className="mb-caption">{running}.</p>}
              </>
            )}
          </>
        )}
      </MenuRow>

      <MenuRow
        icon={<LinkIcon />}
        title="Sources"
        summary={sources.supplied === 0 ? '—' : `${sources.supplied} supplied`}
      >
        {sources.supplied === 0 ? (
          <p className="mb-empty">No sources have been supplied with an answer in this chat yet.</p>
        ) : (
          <>
            <SegmentedBar
              title="How each source was read"
              unit="sources"
              segments={[
                {
                  key: 'live',
                  name: 'Fetched live',
                  label: 'Fetched live',
                  value: sources.live,
                  color: 'var(--viz-1)',
                },
                {
                  key: 'index',
                  name: 'Search-index copy',
                  label: 'Search-index copy',
                  value: sources.supplied - sources.live,
                  color: 'var(--viz-rest)',
                },
              ]}
            />
            <SegmentedBar
              title="Who published it"
              unit="sources"
              segments={[
                {
                  key: 'first',
                  name: 'First-party',
                  label: 'First-party',
                  value: sources.firstParty,
                  color: 'var(--viz-1)',
                },
                {
                  key: 'other',
                  name: 'Other sites',
                  label: 'Other sites',
                  value: sources.supplied - sources.firstParty,
                  color: 'var(--viz-rest)',
                },
              ]}
            />
            <p className="mb-caption">
              Every source supplied with an answer, cited in the text or not; a page supplied to two answers counts
              twice.
            </p>
          </>
        )}
      </MenuRow>

      {evals.errors > 0 ? (
        <MenuRow icon={<AlertIcon />} title="Errors" summary={String(evals.errors)}>
          <p className="mb-empty">
            {evals.errors} {evals.errors === 1 ? 'turn stage' : 'turn stages'} reported an error; the answer cards show
            which.
          </p>
        </MenuRow>
      ) : null}
    </>
  );
}

type SuiteState = { kind: 'loading' } | LoadedSet;

function Squares({ title, cells }: { title: string; cells: CaseCell[] }) {
  return (
    <div className="mb-chart">
      <p className="mb-chart-title">{title}</p>
      <ul className="mb-squares">
        {cells.map((cell) => {
          const text = `Case ${cell.id}: ${STATUS_LABEL[cell.status]}`;
          return (
            <li key={cell.id}>
              <span
                className={`mb-square mb-square-${cell.status}`}
                tabIndex={0}
                role="img"
                aria-label={text}
                data-tip={text}
                title={text}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One result set from /api/evals?set=…, as ready, missing (404) or error. Never rejects. */
async function loadSet(set: 'main' | 'heldout' | 'heldout-first', signal: AbortSignal): Promise<LoadedSet> {
  try {
    const response = await fetch(`/api/evals?set=${set}`, { signal, cache: 'no-store' });
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' && body !== null && 'error' in body ? String((body as { error: unknown }).error) : '';
    if (response.status === 404) return { kind: 'missing', message: message || 'No eval results yet.' };
    if (!response.ok)
      return { kind: 'error', message: message || `The summary could not be loaded (${response.status}).` };
    return { kind: 'ready', summary: body as EvalSummary };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'The summary could not be loaded.' };
  }
}

export function SuiteContent({ titleId, active }: { titleId: string; active: boolean }) {
  const [state, setState] = useState<SuiteState>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  // The "Copied" reset timer; cleared when the popover closes so no callback outlives it.
  const copiedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const [heldout, setHeldout] = useState<{ first: LoadedSet; latest: LoadedSet } | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    loadSet('main', controller.signal).then((main) => {
      if (!controller.signal.aborted) setState(main);
    });
    Promise.all([loadSet('heldout-first', controller.signal), loadSet('heldout', controller.signal)]).then(
      ([first, latest]) => {
        if (!controller.signal.aborted) setHeldout({ first, latest });
      },
    );
    return () => controller.abort();
  }, [active]);

  const copy = () => {
    navigator.clipboard
      ?.writeText(SUITE_COMMAND)
      .then(() => {
        setCopied(true);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(() => undefined);
  };

  const runLine = (
    <div className="mb-plain">
      <span className="mb-row-icon">
        <TerminalIcon />
      </span>
      <span className="mb-plain-text">
        Run the full suite: <code>{SUITE_COMMAND}</code>
      </span>
      <button
        type="button"
        className="mb-copy"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy the command'}
        title={copied ? 'Copied' : 'Copy'}
      >
        {copied ? 'Copied' : <CopyIcon />}
      </button>
    </div>
  );

  if (state.kind !== 'ready') {
    return (
      <>
        <HeadTile
          id={titleId}
          icon={<FlaskIcon size={18} />}
          title="Test suite"
          subtitle={
            state.kind === 'loading'
              ? 'Loading the last run…'
              : state.kind === 'missing'
                ? 'No results yet'
                : 'Could not load the results'
          }
        />
        {state.kind !== 'loading' ? <p className="mb-empty mb-pad">{state.message}</p> : null}
        <hr className="mb-divider" />
        {runLine}
      </>
    );
  }

  const { summary } = state;
  const view = suiteView(summary);
  const counts = {
    pass: summary.passAtAll.length,
    flaky: summary.flaky.length,
    fail: summary.failing.length,
  };
  return (
    <>
      <HeadTile id={titleId} icon={<FlaskIcon size={18} />} title="Test suite" subtitle={view.subtitle}>
        <Facts
          items={[
            ['Commit', <code key="sha">{summary.sha}</code>],
            ['Cases', String(summary.cases)],
            ['Runs per case', String(summary.runs)],
            [
              'Incomplete',
              summary.incomplete.length === 0 ? 'none' : summary.incomplete.map((id) => `#${id}`).join(', '),
            ],
            ['Metered cost', usd(summary.spentUsd)],
          ]}
        />
        <p className="mb-note">Scripted cases against fixture pages, run offline; not this chat.</p>
      </HeadTile>

      <SliderMeter
        label="Scored pass rate"
        share={view.scoredShare}
        valueText={view.scoredText}
        left={<XCircleIcon />}
        right={<CheckCircleIcon />}
        caption={view.caption}
      />

      <div className="mb-tiles">
        <RingTile
          label="Scored"
          share={view.scoredShare}
          valueText={view.scoredTile}
          icon={<CheckCircleIcon size={16} />}
          reason={view.emptyReason ?? undefined}
        />
        <RingTile
          label="Literal"
          share={view.literalShare}
          valueText={view.literalTile}
          icon={<QuoteIcon size={16} />}
          reason={view.emptyReason ?? undefined}
        />
        <RingTile
          label="Cost"
          share={null}
          valueText={usd(summary.spentUsd)}
          icon={<CoinIcon />}
          reason="not recorded"
        />
      </div>

      <hr className="mb-divider" />
      <h3 className="mb-section">Details</h3>

      <MenuRow
        icon={<GridIcon />}
        title="Cases"
        summary={`${counts.pass} pass · ${counts.flaky} flaky · ${counts.fail} fail`}
      >
        <Squares title="Scored, one square per case" cells={view.cells} />
        <Squares title="The spec's literal check" cells={view.literalCells} />
        <ul className="mb-legend mb-legend-row">
          <li>
            <span className="mb-square mb-square-pass" aria-hidden="true" /> Pass
          </li>
          <li>
            <span className="mb-square mb-square-flaky" aria-hidden="true" /> Flaky
          </li>
          <li>
            <span className="mb-square mb-square-fail" aria-hidden="true" /> Fail
          </li>
        </ul>
      </MenuRow>

      <MenuRow icon={<XCircleIcon size={15} />} title="Flaky and failing" summary={`${counts.flaky + counts.fail}`}>
        <Facts
          items={[
            ['Flaky (scored)', summary.flaky.length === 0 ? 'none' : summary.flaky.map((id) => `#${id}`).join(', ')],
            [
              'Failing (scored)',
              summary.failing.length === 0 ? 'none' : summary.failing.map((id) => `#${id}`).join(', '),
            ],
            [
              'Flaky (literal)',
              summary.strict.flaky.length === 0 ? 'none' : summary.strict.flaky.map((id) => `#${id}`).join(', '),
            ],
            [
              'Failing (literal)',
              summary.strict.failing.length === 0 ? 'none' : summary.strict.failing.map((id) => `#${id}`).join(', '),
            ],
          ]}
        />
        <p className="mb-caption">Case ids only: the summary does not carry assertion names.</p>
      </MenuRow>

      <HeldoutSection sets={heldout} />

      <hr className="mb-divider" />
      {runLine}
    </>
  );
}

/** The held-out set (cases 101–119): first run, after fixes, and the latest run's squares. */
function HeldoutSection({ sets }: { sets: { first: LoadedSet; latest: LoadedSet } | null }) {
  return (
    <section aria-labelledby="heldout-title">
      <hr className="mb-divider" />
      <h3 className="mb-section" id="heldout-title">
        Held-out set (cases nobody tuned against)
      </h3>
      {sets === null ? (
        <p className="mb-empty mb-pad">Loading the held-out runs…</p>
      ) : (
        <HeldoutBody view={heldoutView(sets.first, sets.latest)} />
      )}
    </section>
  );
}

function HeldoutBody({ view }: { view: ReturnType<typeof heldoutView> }) {
  return (
    <>
      <p className="mb-note mb-pad-x">First run is the honest number; later runs follow fixes.</p>
      <SliderMeter
        label="First-run pass rate"
        share={view.firstShare}
        valueText={view.sliderText}
        left={<XCircleIcon />}
        right={<CheckCircleIcon />}
        caption={view.caption}
      />
      <div className="mb-tiles mb-tiles-2">
        <RingTile
          label="First run"
          share={view.firstShare}
          valueText={view.firstTile}
          icon={<FlaskIcon size={16} />}
          reason={view.firstReason ?? undefined}
        />
        <RingTile
          label="After fixes"
          share={view.afterShare}
          valueText={view.afterTile}
          icon={<CheckCircleIcon size={16} />}
          reason={view.afterReason ?? undefined}
        />
      </div>
      <MenuRow icon={<GridIcon />} title="Held-out cases" summary={view.cellsSummary}>
        {view.cells.length === 0 ? (
          <p className="mb-empty">{view.cellsLabel}</p>
        ) : (
          <Squares title={view.cellsLabel} cells={view.cells} />
        )}
      </MenuRow>
    </>
  );
}
