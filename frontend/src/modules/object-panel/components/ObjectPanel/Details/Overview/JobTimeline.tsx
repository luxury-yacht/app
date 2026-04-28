/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/JobTimeline.tsx
 *
 * Horizontal SVG timeline showing recent CronJob runs as colored bars
 * positioned by start time and sized by duration. Multiple windows are
 * selectable via a chip-group above the strip.
 *
 * Color encoding follows StatusChip semantics: healthy = success,
 * unhealthy = failure, info = currently running. Sub-pixel-thin runs
 * get a minimum visible width so a one-second job is still findable.
 */

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import './JobTimeline.css';

interface JobLike {
  name?: string;
  status?: string;
  startTime?: unknown;
  durationSeconds?: number;
  duration?: string;
}

interface JobTimelineProps {
  jobs: JobLike[];
  /** Called with the job name when a timeline bar is clicked. When
   *  unset, bars render as non-interactive divs. */
  onJobClick?: (name: string) => void;
}

interface WindowOption {
  label: string;
  seconds: number;
  /** Tick interval in seconds — chosen so we get ~6 ticks across the strip. */
  tickInterval: number;
  /** How to format a tick label given a Date. */
  tickLabel: (d: Date) => string;
}

const HOUR = 3600;
const DAY = 24 * HOUR;

const WINDOWS: WindowOption[] = [
  {
    label: '1h',
    seconds: HOUR,
    tickInterval: 10 * 60,
    tickLabel: (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  },
  {
    label: '3h',
    seconds: 3 * HOUR,
    tickInterval: 30 * 60,
    tickLabel: (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  },
  {
    label: '6h',
    seconds: 6 * HOUR,
    tickInterval: HOUR,
    tickLabel: (d) => d.toLocaleTimeString(undefined, { hour: 'numeric' }),
  },
  {
    label: '12h',
    seconds: 12 * HOUR,
    tickInterval: 2 * HOUR,
    tickLabel: (d) => d.toLocaleTimeString(undefined, { hour: 'numeric' }),
  },
  {
    label: '1d',
    seconds: 24 * HOUR,
    tickInterval: 4 * HOUR,
    tickLabel: (d) => d.toLocaleTimeString(undefined, { hour: 'numeric' }),
  },
  {
    label: '2d',
    seconds: 2 * DAY,
    tickInterval: 12 * HOUR,
    tickLabel: (d) => d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric' }),
  },
  {
    label: '1w',
    seconds: 7 * DAY,
    tickInterval: DAY,
    tickLabel: (d) => d.toLocaleDateString(undefined, { weekday: 'short' }),
  },
];

const DEFAULT_WINDOW = WINDOWS[1]; // 3h

const parseStart = (raw: unknown): number | null => {
  if (typeof raw !== 'string' || !raw) return null;
  const t = new Date(raw).getTime();
  return isNaN(t) ? null : t;
};

const variantClass = (status?: string): string => {
  const s = (status ?? '').toLowerCase();
  if (s.includes('complete') || s === 'succeeded') return 'job-timeline-bar--healthy';
  if (s.includes('fail')) return 'job-timeline-bar--unhealthy';
  if (s.includes('run') || s.includes('active')) return 'job-timeline-bar--running';
  return 'job-timeline-bar--info';
};

interface PositionedJob {
  job: JobLike;
  /** % of strip width from the left. */
  leftPct: number;
  /** % of strip width consumed. Already capped at the right edge. */
  widthPct: number;
  /** Fractional row index after stacking — visual row. */
  row: number;
  /** True when the run started before the visible window — clipped on the left. */
  clippedStart: boolean;
}

/** Pack runs into rows so overlapping bars stack instead of obscuring
 *  each other. Greedy first-fit by row, walking jobs in start-time order. */
const stackRows = (runs: PositionedJob[]): { runs: PositionedJob[]; rowCount: number } => {
  const rowEnds: number[] = [];
  const sorted = [...runs].sort((a, b) => a.leftPct - b.leftPct);
  for (const r of sorted) {
    let placed = false;
    for (let i = 0; i < rowEnds.length; i++) {
      if (rowEnds[i] <= r.leftPct + 0.001) {
        r.row = i;
        rowEnds[i] = r.leftPct + r.widthPct;
        placed = true;
        break;
      }
    }
    if (!placed) {
      r.row = rowEnds.length;
      rowEnds.push(r.leftPct + r.widthPct);
    }
  }
  return { runs: sorted, rowCount: Math.max(1, rowEnds.length) };
};

const MIN_BAR_WIDTH_PCT = 0.4; // ~2-3px on a typical strip
const ROW_HEIGHT = 12;
const ROW_GAP = 2;

/** Minimum horizontal space (px) between adjacent tick labels — below
 *  this they start to crowd or overlap. Tick labels are centered on
 *  their tick, so this is effectively the minimum center-to-center
 *  gap. Sized for labels like "11:30 AM" which are ~55-60px wide; the
 *  rest is breathing room so adjacent labels don't visually touch. */
const MIN_TICK_SPACING_PX = 60;

export const JobTimeline: React.FC<JobTimelineProps> = ({ jobs, onJobClick }) => {
  const [windowOpt, setWindowOpt] = useState<WindowOption>(DEFAULT_WINDOW);
  const stripRef = useRef<HTMLDivElement>(null);
  // Default to a typical panel width so the FIRST render already picks
  // a reasonable tick density. ResizeObserver updates this to the real
  // measurement as soon as layout settles.
  const [stripWidth, setStripWidth] = useState(300);

  // Track the strip's rendered width so the tick density can react to
  // panel resizing. useLayoutEffect runs synchronously after DOM commit
  // and before paint, so the corrected width is in place by the time
  // the user sees anything.
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measured = el.getBoundingClientRect().width;
    if (measured > 0) setStripWidth(measured);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setStripWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { runs, rowCount, ticks, now } = useMemo(() => {
    const nowMs = Date.now();
    const windowMs = windowOpt.seconds * 1000;
    const cutoffMs = nowMs - windowMs;

    const positioned: PositionedJob[] = [];
    for (const job of jobs) {
      const startMs = parseStart(job.startTime);
      if (startMs === null) continue;
      const dur = Math.max(0, (job.durationSeconds ?? 0) * 1000);
      const endMs = startMs + dur;
      // Skip runs that ended before the window started.
      if (endMs < cutoffMs) continue;

      const clippedStart = startMs < cutoffMs;
      const visibleStart = Math.max(startMs, cutoffMs);
      const visibleEnd = Math.min(endMs, nowMs);
      const leftPct = ((visibleStart - cutoffMs) / windowMs) * 100;
      let widthPct = ((visibleEnd - visibleStart) / windowMs) * 100;
      if (widthPct < MIN_BAR_WIDTH_PCT) widthPct = MIN_BAR_WIDTH_PCT;
      // Don't run off the right edge.
      if (leftPct + widthPct > 100) widthPct = Math.max(MIN_BAR_WIDTH_PCT, 100 - leftPct);

      positioned.push({ job, leftPct, widthPct, row: 0, clippedStart });
    }

    const stacked = stackRows(positioned);

    // Tick positions, anchored to the right (now) and walking back.
    // The window's `tickInterval` is the *baseline* density; if the
    // strip is narrower than that allows, multiply the interval until
    // adjacent labels have at least MIN_TICK_SPACING_PX between them.
    let tickIntervalMs = windowOpt.tickInterval * 1000;
    const baselineSpacingPx = (tickIntervalMs / windowMs) * stripWidth;
    if (baselineSpacingPx > 0 && baselineSpacingPx < MIN_TICK_SPACING_PX) {
      const factor = Math.ceil(MIN_TICK_SPACING_PX / baselineSpacingPx);
      tickIntervalMs *= factor;
    }
    const tickList: { leftPct: number; label: string }[] = [];
    // First tick is the most recent boundary at or before "now".
    const firstTickMs = Math.floor(nowMs / tickIntervalMs) * tickIntervalMs;
    for (let t = firstTickMs; t > cutoffMs; t -= tickIntervalMs) {
      const leftPct = ((t - cutoffMs) / windowMs) * 100;
      tickList.push({ leftPct, label: windowOpt.tickLabel(new Date(t)) });
    }

    return {
      runs: stacked.runs,
      rowCount: stacked.rowCount,
      ticks: tickList,
      now: nowMs,
    };
  }, [jobs, windowOpt, stripWidth]);

  const stripHeight = rowCount * ROW_HEIGHT + (rowCount - 1) * ROW_GAP;

  return (
    <div className="job-timeline">
      <div className="job-timeline-controls">
        {WINDOWS.map((w) => (
          <button
            key={w.label}
            type="button"
            className={`job-timeline-window${
              w.label === windowOpt.label ? ' job-timeline-window--active' : ''
            }`}
            onClick={() => setWindowOpt(w)}
          >
            {w.label}
          </button>
        ))}
      </div>

      <div ref={stripRef} className="job-timeline-strip" style={{ height: stripHeight }}>
        {/* Grid lines — one vertical mark per axis tick, behind the
            bars, so users can read where each labeled time falls
            relative to a bar without dropping eyes to the axis. */}
        {ticks.map((t, i) => (
          <div
            key={`grid-${i}`}
            className="job-timeline-gridline"
            style={{ left: `${t.leftPct}%` }}
          />
        ))}
        {runs.length === 0 && (
          <div className="job-timeline-empty">No runs in last {windowOpt.label}</div>
        )}
        {runs.map((r, i) => {
          const startMs = parseStart(r.job.startTime) ?? now;
          const startStr = new Date(startMs).toLocaleString();
          const tooltip = [
            r.job.name,
            r.job.status,
            `Started ${startStr}`,
            r.job.duration ? `Duration ${r.job.duration}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const className = `job-timeline-bar ${variantClass(r.job.status)}${
            r.clippedStart ? ' job-timeline-bar--clipped' : ''
          }${onJobClick && r.job.name ? ' job-timeline-bar--clickable' : ''}`;
          const style: React.CSSProperties = {
            left: `${r.leftPct}%`,
            width: `${r.widthPct}%`,
            top: r.row * (ROW_HEIGHT + ROW_GAP),
            height: ROW_HEIGHT,
          };
          const key = `${r.job.name ?? 'job'}-${i}`;

          if (onJobClick && r.job.name) {
            const jobName = r.job.name;
            return (
              <button
                key={key}
                type="button"
                className={className}
                style={style}
                title={tooltip}
                aria-label={`Open job ${jobName}`}
                onClick={() => onJobClick(jobName)}
              />
            );
          }
          return <div key={key} className={className} style={style} title={tooltip} />;
        })}
      </div>

      <div className="job-timeline-axis">
        {ticks.map((t, i) => (
          <div key={i} className="job-timeline-tick" style={{ left: `${t.leftPct}%` }}>
            <span className="job-timeline-tick-label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
