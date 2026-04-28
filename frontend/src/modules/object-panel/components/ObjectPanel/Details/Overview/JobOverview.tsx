/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/JobOverview.tsx
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { formatAge, formatFullDate } from '@/utils/ageFormatter';
import { JobTimeline } from './JobTimeline';
import './shared/OverviewBlocks.css';

/** k8s metav1.Time arrives as an RFC3339 string at runtime even though
 *  the wails-generated type claims `v1.Time`. Treat anything that isn't
 *  a non-empty string as missing. */
const normalizeTime = (t: unknown): string | undefined => {
  if (typeof t === 'string' && t.length > 0) return t;
  return undefined;
};

/** Render a timestamp as relative age plus a tooltip with the full date.
 *  Uses a chip-less span — these aren't statuses, just timestamps. */
const TimestampValue: React.FC<{ value: unknown; missing?: string }> = ({
  value,
  missing = 'Never',
}) => {
  const iso = normalizeTime(value);
  if (!iso) return <>{missing}</>;
  return <span title={formatFullDate(iso)}>{formatAge(iso)} ago</span>;
};

/** Format a future timestamp as "in 2h 15m" / "in 15m" / "in 30s".
 *  Includes minutes alongside hours so the readout doesn't jump in
 *  hour-sized increments — important for "Next Run", which is the
 *  field the user actually checks for "when does this fire next". */
const formatTimeUntil = (iso: string): string => {
  const target = new Date(iso).getTime();
  if (isNaN(target)) return '';
  const ms = target - Date.now();
  if (ms <= 0) return 'now';
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

  const activeCount = Array.isArray(props.activeJobs)
    ? props.activeJobs.length
    : (props.activeJobs ?? 0);

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

          {/* Next-run information — the most operationally useful field
              for a CronJob. Hidden when suspended (it won't fire). */}
          {!props.suspend && props.nextScheduleTime && (
            <OverviewItem
              label="Next Run"
              value={
                <span title={formatFullDate(props.nextScheduleTime)}>
                  {(() => {
                    const until = formatTimeUntil(props.nextScheduleTime);
                    return until ? `in ${until}` : formatFullDate(props.nextScheduleTime);
                  })()}
                </span>
              }
            />
          )}

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
              value={<JobTimeline jobs={props.jobs} />}
            />
          )}

          {/* Activity timeline */}
          <OverviewItem
            label="Last Schedule"
            value={<TimestampValue value={props.lastScheduleTime} />}
          />

          {normalizeTime(props.lastSuccessfulTime) && (
            <OverviewItem
              label="Last Success"
              value={<TimestampValue value={props.lastSuccessfulTime} />}
            />
          )}

          {/* History retention — these are caps on how many old job
              records to keep, not an outcome count. Render as-is when
              non-default (k8s defaults are 3 / 1). */}
          {((props.successfulJobsHistory !== undefined && props.successfulJobsHistory !== 3) ||
            (props.failedJobsHistory !== undefined && props.failedJobsHistory !== 1)) && (
            <OverviewItem
              label="History Limits"
              value={
                <span title="Maximum number of completed/failed Job records the controller retains for inspection.">
                  {`${props.successfulJobsHistory ?? 3} succeeded, ${
                    props.failedJobsHistory ?? 1
                  } failed`}
                </span>
              }
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
