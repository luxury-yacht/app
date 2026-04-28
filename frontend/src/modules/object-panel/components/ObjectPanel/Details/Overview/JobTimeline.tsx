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

import React, { useMemo, useState } from 'react';
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
    label: '3h',
    seconds: 3 * HOUR,
    tickInterval: 30 * 60,
    tickLabel: (d) =>
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  },
  {
    label: '12h',
    seconds: 12 * HOUR,
    tickInterval: 2 * HOUR,
    tickLabel: (d) => d.toLocaleTimeString(undefined, { hour: 'numeric' }),
  },
  {
    label: '24h',
    seconds: 24 * HOUR,
    tickInterval: 4 * HOUR,
    tickLabel: (d) => d.toLocaleTimeString(undefined, { hour: 'numeric' }),
  },
  {
    label: '2d',
    seconds: 2 * DAY,
    tickInterval: 12 * HOUR,
    tickLabel: (d) =>
      d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric' }),
  },
  {
    label: '1w',
    seconds: 7 * DAY,
    tickInterval: DAY,
    tickLabel: (d) => d.toLocaleDateString(undefined, { weekday: 'short' }),
  },
];

const DEFAULT_WINDOW = WINDOWS[0]; // 3h

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

export const JobTimeline: React.FC<JobTimelineProps> = ({ jobs }) => {
  const [windowOpt, setWindowOpt] = useState<WindowOption>(DEFAULT_WINDOW);

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
    const tickList: { leftPct: number; label: string }[] = [];
    const tickIntervalMs = windowOpt.tickInterval * 1000;
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
  }, [jobs, windowOpt]);

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

      <div className="job-timeline-strip" style={{ height: stripHeight }}>
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
          return (
            <div
              key={`${r.job.name ?? 'job'}-${i}`}
              className={`job-timeline-bar ${variantClass(r.job.status)}${
                r.clippedStart ? ' job-timeline-bar--clipped' : ''
              }`}
              style={{
                left: `${r.leftPct}%`,
                width: `${r.widthPct}%`,
                top: r.row * (ROW_HEIGHT + ROW_GAP),
                height: ROW_HEIGHT,
              }}
              title={tooltip}
            />
          );
        })}
      </div>

      <div className="job-timeline-axis">
        {ticks.map((t, i) => (
          <div
            key={i}
            className="job-timeline-tick"
            style={{ left: `${t.leftPct}%` }}
          >
            <span className="job-timeline-tick-label">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
