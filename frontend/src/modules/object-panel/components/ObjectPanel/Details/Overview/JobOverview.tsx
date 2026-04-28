/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/JobOverview.tsx
 */

import React, { useCallback } from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import Tooltip from '@shared/components/Tooltip';
import { buildObjectReference } from '@shared/utils/objectIdentity';
import { JobTimeline } from './JobTimeline';
import './shared/OverviewBlocks.css';
import './JobOverview.css';

/** k8s metav1.Time arrives as an RFC3339 string at runtime even though
 *  the wails-generated type claims `v1.Time`. Treat anything that isn't
 *  a non-empty string as missing. */
const normalizeTime = (t: unknown): string | undefined => {
  if (typeof t === 'string' && t.length > 0) return t;
  return undefined;
};

/** Format a timestamp as `YYYY-MM-DD HH:mm:ss` in local time. Used in
 *  tooltips where unambiguous, sortable formatting matters more than
 *  locale conventions. */
const formatLocalDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};

/** Format a positive duration in milliseconds as "2h 15m" / "15m" /
 *  "30s" / "3d 4h". Includes the second-largest unit alongside the
 *  largest so the readout doesn't jump in hour- or day-sized
 *  increments — useful for both "in X" (future) and "X ago" (past). */
const formatDuration = (ms: number): string => {
  if (ms <= 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return `${secs}s`;
};

/** Render a timestamp as relative time plus a tooltip with the full
 *  date. Uses the same h+m / d+h granularity as the "Next Run" cell so
 *  every relative-time readout in this view follows one rule. */
const TimestampValue: React.FC<{ value: unknown; missing?: string }> = ({
  value,
  missing = 'Never',
}) => {
  const iso = normalizeTime(value);
  if (!iso) return <>{missing}</>;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return <>{missing}</>;
  const elapsed = Date.now() - t;
  const label = elapsed <= 0 ? 'just now' : `${formatDuration(elapsed)} ago`;
  return <span title={formatLocalDateTime(iso)}>{label}</span>;
};

/** Format a relative-time value. Future timestamps render as
 *  "in 2h 15m"; past as "2h 15m ago"; nil as "—". */
const formatRelative = (raw: unknown): string => {
  const iso = normalizeTime(raw);
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const ms = t - Date.now();
  if (ms > 0) return `in ${formatDuration(ms)}`;
  if (ms === 0) return 'just now';
  return `${formatDuration(-ms)} ago`;
};

/** Tooltip for the row when its value is "—" — Last Manual / Last
 *  Failure can be missing because nothing has happened, OR because
 *  the underlying Job record was GC'd. We can't tell which from the
 *  data, so we say so. */
const RETENTION_TOOLTIP =
  'Empty when no such run exists, or when the Job record has been garbage-collected per the CronJob’s history retention.';

interface RunSummaryProps {
  suspend?: boolean;
  nextScheduleTime?: string;
  lastScheduleTime?: unknown;
  lastManualTime?: unknown;
  lastSuccessfulTime?: unknown;
  lastFailureTime?: unknown;
}

/** Tabular block of recent run timestamps. Hidden rows just render an
 *  em-dash so the column alignment never wobbles. */
const RunSummary: React.FC<RunSummaryProps> = ({
  suspend,
  nextScheduleTime,
  lastScheduleTime,
  lastManualTime,
  lastSuccessfulTime,
  lastFailureTime,
}) => {
  const nextStr = suspend ? 'Suspended' : formatRelative(nextScheduleTime);
  const rows: Array<{ label: string; value: string; retention?: boolean; iso?: string }> = [
    { label: 'Next Scheduled', value: nextStr, iso: nextScheduleTime },
    {
      label: 'Last Scheduled',
      value: formatRelative(lastScheduleTime),
      iso: normalizeTime(lastScheduleTime),
    },
    {
      label: 'Last Manual',
      value: formatRelative(lastManualTime),
      iso: normalizeTime(lastManualTime),
      retention: true,
    },
    {
      label: 'Last Success',
      value: formatRelative(lastSuccessfulTime),
      iso: normalizeTime(lastSuccessfulTime),
    },
    {
      label: 'Last Failure',
      value: formatRelative(lastFailureTime),
      iso: normalizeTime(lastFailureTime),
      retention: true,
    },
  ];

  return (
    <div className="run-summary">
      {rows.map((r) => {
        const tooltip = r.iso
          ? formatLocalDateTime(r.iso)
          : r.retention
            ? RETENTION_TOOLTIP
            : undefined;
        const value = <span className="run-summary-value">{r.value}</span>;
        return (
          <div key={r.label} className="run-summary-row">
            <span className="run-summary-label">{r.label}</span>
            {tooltip ? (
              <Tooltip content={tooltip} className="run-summary-tooltip">
                {value}
              </Tooltip>
            ) : (
              value
            )}
          </div>
        );
      })}
    </div>
  );
};

/** Concurrency policy tooltips — these change what happens when a run
 *  is still active at the next schedule tick, so worth explaining. */
const concurrencyTooltip = (policy: string): string | undefined => {
  switch (policy) {
    case 'Allow':
      return 'New runs start regardless of whether previous runs are still active. Multiple jobs may run concurrently.';
    case 'Forbid':
      return 'If the previous run is still active when the schedule fires, the new run is skipped.';
    case 'Replace':
      return 'If the previous run is still active when the schedule fires, it is cancelled and replaced by the new run.';
    default:
      return undefined;
  }
};

const concurrencyVariant = (policy: string): StatusChipVariant => {
  if (policy === 'Forbid' || policy === 'Replace') return 'warning';
  return 'info';
};

/** Map Job `status` (e.g. "Complete", "Failed", "Running", "Suspended")
 *  to a chip variant. Falls back to info for unknown values. */
const jobStatusVariant = (status: string): StatusChipVariant => {
  const s = status.toLowerCase();
  if (s.includes('complete') || s === 'succeeded') return 'healthy';
  if (s.includes('fail')) return 'unhealthy';
  if (s.includes('suspend')) return 'warning';
  return 'info';
};

interface JobOverviewProps {
  kind?: string;
  name?: string;
  namespace?: string;
  age?: string;

  // Job fields
  status?: string;
  completions?: number;
  succeeded?: number;
  active?: number | string;
  failed?: number;
  duration?: string;
  parallelism?: number;
  backoffLimit?: number;
  startTime?: unknown;
  completionTime?: unknown;
  activeDeadlineSeconds?: number;
  ttlSecondsAfterFinished?: number;
  completionMode?: string;

  // Suspend applies to both Job and CronJob.
  suspend?: boolean;

  // CronJob fields
  schedule?: string;
  activeJobs?: number | any[];
  jobs?: Array<{
    name?: string;
    status?: string;
    startTime?: unknown;
    durationSeconds?: number;
    duration?: string;
  }>;
  lastScheduleTime?: unknown;
  lastSuccessfulTime?: unknown;
  lastManualTime?: unknown;
  lastFailureTime?: unknown;
  nextScheduleTime?: string;
  timeUntilNextSchedule?: string;
  concurrencyPolicy?: string;
  startingDeadlineSeconds?: number;
  successfulJobsHistory?: number;
  failedJobsHistory?: number;

  // Metadata
  selector?: Record<string, string>;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export const JobOverview: React.FC<JobOverviewProps> = (props) => {
  const { kind, name, namespace, age } = props;
  const isJob = props.kind?.toLowerCase() === 'job';
  const isCronJob = props.kind?.toLowerCase() === 'cronjob';

  const { openWithObject, objectData } = useObjectPanel();

  const activeCount = Array.isArray(props.activeJobs)
    ? props.activeJobs.length
    : (props.activeJobs ?? 0);

  // Open the Job in the panel when a timeline bar is clicked. Owned
  // Jobs share the CronJob's namespace, and the cluster context comes
  // from the panel's current objectData.
  const onJobClick = useCallback(
    (jobName: string) => {
      if (!namespace) return;
      openWithObject(
        buildObjectReference({
          kind: 'Job',
          name: jobName,
          namespace,
          clusterId: objectData?.clusterId ?? undefined,
          clusterName: objectData?.clusterName ?? undefined,
        })
      );
    },
    [namespace, objectData?.clusterId, objectData?.clusterName, openWithObject]
  );

  return (
    <>
      <ResourceHeader kind={kind || ''} name={name || ''} namespace={namespace} age={age} />

      {/* Job-specific fields */}
      {isJob && (
        <>
          {/* Suspended state — surface first; it changes interpretation
              of every other field below. */}
          {props.suspend && (
            <OverviewItem
              label="Status"
              value={<StatusChip variant="warning">Suspended</StatusChip>}
            />
          )}

          {/* Status — the controller's view (Complete / Failed / etc).
              Skipped when the run is in-progress (no terminal status yet). */}
          {props.status && !props.suspend && (
            <OverviewItem
              label="Status"
              value={
                <StatusChip variant={jobStatusVariant(props.status)}>{props.status}</StatusChip>
              }
            />
          )}

          {/* Completion progress */}
          {props.completions !== undefined && (
            <OverviewItem
              label="Completions"
              value={
                props.succeeded === props.completions ? (
                  <StatusChip variant="healthy">{`${props.succeeded}/${props.completions}`}</StatusChip>
                ) : (
                  `${props.succeeded || 0}/${props.completions}`
                )
              }
            />
          )}

          {/* Active/Failed counts — only when non-zero */}
          {props.active !== undefined && Number(props.active) > 0 && (
            <OverviewItem
              label="Active"
              value={<StatusChip variant="info">{props.active}</StatusChip>}
            />
          )}

          {props.failed !== undefined && props.failed > 0 && (
            <OverviewItem
              label="Failed"
              value={<StatusChip variant="unhealthy">{props.failed}</StatusChip>}
            />
          )}

          {/* Timeline */}
          {normalizeTime(props.startTime) && (
            <OverviewItem label="Started" value={<TimestampValue value={props.startTime} />} />
          )}

          {normalizeTime(props.completionTime) && (
            <OverviewItem
              label="Completed"
              value={<TimestampValue value={props.completionTime} />}
            />
          )}

          {props.duration && <OverviewItem label="Duration" value={props.duration} />}

          {/* Configuration — only show non-defaults */}
          {props.parallelism && props.parallelism > 1 && (
            <OverviewItem label="Parallelism" value={props.parallelism} />
          )}

          {props.backoffLimit !== undefined && props.backoffLimit !== 6 && (
            <OverviewItem label="Backoff Limit" value={props.backoffLimit} />
          )}

          {props.completionMode && props.completionMode !== 'NonIndexed' && (
            <OverviewItem
              label="Completion Mode"
              value={
                <StatusChip
                  variant="info"
                  tooltip="Each pod gets a unique 0-based index (JOB_COMPLETION_INDEX env var) so completions can be partitioned across parallel pods."
                >
                  {props.completionMode}
                </StatusChip>
              }
            />
          )}

          {props.activeDeadlineSeconds !== undefined && props.activeDeadlineSeconds > 0 && (
            <OverviewItem label="Active Deadline" value={`${props.activeDeadlineSeconds}s`} />
          )}

          {props.ttlSecondsAfterFinished !== undefined && props.ttlSecondsAfterFinished >= 0 && (
            <OverviewItem label="TTL Seconds" value={`${props.ttlSecondsAfterFinished}s`} />
          )}
        </>
      )}

      {/* CronJob-specific fields */}
      {isCronJob && (
        <>
          {/* Suspended state first */}
          {props.suspend && (
            <OverviewItem
              label="Status"
              value={<StatusChip variant="warning">Suspended</StatusChip>}
            />
          )}

          <OverviewItem label="Schedule" value={<code>{props.schedule}</code>} />

          {/* Concurrency policy — chip with tooltip when non-default. */}
          {props.concurrencyPolicy && props.concurrencyPolicy !== 'Allow' && (
            <OverviewItem
              label="Concurrency"
              value={
                <StatusChip
                  variant={concurrencyVariant(props.concurrencyPolicy)}
                  tooltip={concurrencyTooltip(props.concurrencyPolicy)}
                >
                  {props.concurrencyPolicy}
                </StatusChip>
              }
            />
          )}

          {props.startingDeadlineSeconds !== undefined &&
            props.startingDeadlineSeconds !== null && (
              <OverviewItem label="Start Deadline" value={`${props.startingDeadlineSeconds}s`} />
            )}

          {/* Active runs */}
          {Number(activeCount) > 0 && (
            <OverviewItem
              label="Active Jobs"
              value={<StatusChip variant="info">{activeCount}</StatusChip>}
            />
          )}

          {/* Run-history timeline — visual strip of recent runs sized
              by duration and colored by outcome. Rendered only when we
              have at least one Job record to plot. */}
          {props.jobs && props.jobs.length > 0 && (
            <OverviewItem
              label="History"
              fullWidth
              value={<JobTimeline jobs={props.jobs} onJobClick={onJobClick} />}
            />
          )}

          {/* Run summary — collapses Next Scheduled, Last Scheduled,
              Last Manual, Last Success, Last Failure into one labeled
              block. Last Manual / Last Failure are bounded by Job
              retention; "—" can mean either "never" or "older than the
              retained history" — the tooltip clarifies. */}
          <OverviewItem
            label="Runs"
            fullWidth
            value={
              <RunSummary
                suspend={props.suspend}
                nextScheduleTime={props.nextScheduleTime}
                lastScheduleTime={props.lastScheduleTime}
                lastManualTime={props.lastManualTime}
                lastSuccessfulTime={props.lastSuccessfulTime}
                lastFailureTime={props.lastFailureTime}
              />
            }
          />

          {/* History retention — these are caps on how many old job
              records to keep, not an outcome count. Render as-is when
              non-default (k8s defaults are 3 / 1). */}
          {((props.successfulJobsHistory !== undefined && props.successfulJobsHistory !== 3) ||
            (props.failedJobsHistory !== undefined && props.failedJobsHistory !== 1)) && (
            <OverviewItem
              label="History Limits"
              value={`${props.successfulJobsHistory ?? 3} succeeded, ${
                props.failedJobsHistory ?? 1
              } failed`}
            />
          )}
        </>
      )}

      <ResourceMetadata
        labels={props.labels}
        annotations={props.annotations}
        selector={props.selector}
        showSelector={isJob}
      />
    </>
  );
};
