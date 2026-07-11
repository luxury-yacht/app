/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/job.tsx
 *
 * Job and CronJob Overview descriptors (X1). Presentation ported verbatim from JobOverview.tsx.
 * Each kind gets its own descriptor. The JobTimeline strip and the RunSummary block are irreducible
 * per-kind UI, so they ride along as `widget` items reusing the existing JobTimeline component.
 */

import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import Tooltip from '@shared/components/Tooltip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { cronjob, job } from '@wailsjs/go/models';
import type React from 'react';
import { useCallback } from 'react';
import { JobTimeline } from '../JobTimeline';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import { OverviewItem } from '../shared/OverviewItem';
import '../shared/OverviewBlocks.css';
import '../JobOverview.css';

type JobDetails = job.JobDetails;
type CronJobDetails = cronjob.CronJobDetails;

/** k8s metav1.Time arrives as an RFC3339 string at runtime even though
 *  the wails-generated type claims `v1.Time`. Treat anything that isn't
 *  a non-empty string as missing. */
const normalizeTime = (t: unknown): string | undefined => {
  if (typeof t === 'string' && t.length > 0) {
    return t;
  }
  return undefined;
};

/** Format a timestamp as `YYYY-MM-DD HH:mm:ss` in local time. Used in
 *  tooltips where unambiguous, sortable formatting matters more than
 *  locale conventions. */
const formatLocalDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '-';
  }
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
  if (ms <= 0) {
    return '0s';
  }
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  if (mins > 0) {
    return `${mins}m`;
  }
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
  if (!iso) {
    return <>{missing}</>;
  }
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    return <>{missing}</>;
  }
  const elapsed = Date.now() - t;
  const label = elapsed <= 0 ? 'just now' : `${formatDuration(elapsed)} ago`;
  return <span title={formatLocalDateTime(iso)}>{label}</span>;
};

/** Format a relative-time value. Future timestamps render as
 *  "in 2h 15m"; past as "2h 15m ago"; nil as "—". */
const formatRelative = (raw: unknown): string => {
  const iso = normalizeTime(raw);
  if (!iso) {
    return '—';
  }
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    return '—';
  }
  const ms = t - Date.now();
  if (ms > 0) {
    return `in ${formatDuration(ms)}`;
  }
  if (ms === 0) {
    return 'just now';
  }
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
  if (policy === 'Forbid' || policy === 'Replace') {
    return 'warning';
  }
  return 'info';
};

/** Map Job `status` (e.g. "Complete", "Failed", "Running", "Suspended")
 *  to a chip variant. Falls back to info for unknown values. */
const jobStatusVariant = (status: string): StatusChipVariant => {
  const s = status.toLowerCase();
  if (s.includes('complete') || s === 'succeeded') {
    return 'healthy';
  }
  if (s.includes('fail')) {
    return 'unhealthy';
  }
  if (s.includes('suspend')) {
    return 'warning';
  }
  return 'info';
};

const activeJobCount = (d: CronJobDetails): number => (d.activeJobs ?? []).length;

/** Run-history timeline strip for a CronJob. Wraps JobTimeline so the
 *  bar-click handler can open the owned Job in the panel — that needs
 *  the panel hook, which only a component (not a render fn) can call. */
const CronJobHistory: React.FC<{ data: CronJobDetails; context: OverviewContext }> = ({
  data,
  context,
}) => {
  const { openWithObject } = useObjectPanel();
  const { namespace } = data;
  // Owned Jobs share the CronJob's namespace and cluster.
  const onJobClick = useCallback(
    (jobName: string) => {
      if (!namespace) {
        return;
      }
      openWithObject(
        buildRequiredObjectReference({
          kind: 'Job',
          name: jobName,
          namespace,
          clusterId: context.clusterId ?? undefined,
          clusterName: context.clusterName ?? undefined,
        })
      );
    },
    [namespace, context.clusterId, context.clusterName, openWithObject]
  );

  return <JobTimeline jobs={data.jobs ?? []} onJobClick={onJobClick} />;
};

export const jobDescriptor: OverviewDescriptor<JobDetails> = {
  displayKind: 'Job',
  dtoClass: job.JobDetails,
  schema: {
    showSelector: true,
    items: [
      // Suspended state — surface first; it changes interpretation of
      // every other field below. The controller's terminal status
      // (Complete / Failed / etc) is skipped while suspended or while a
      // run is still in-progress (no terminal status yet).
      {
        field: 'status',
        derivedFrom: ['suspend'],
        label: 'Status',
        hidden: (d) => !(d.suspend || d.status),
        render: (d) => {
          if (d.suspend) {
            return <StatusChip variant="warning">Suspended</StatusChip>;
          }
          if (d.status) {
            return <StatusChip variant={jobStatusVariant(d.status)}>{d.status}</StatusChip>;
          }
          return null;
        },
      },
      // Completion progress.
      {
        field: 'completions',
        derivedFrom: ['succeeded'],
        label: 'Completions',
        hidden: (d) => d.completions === undefined,
        render: (d) =>
          d.succeeded === d.completions ? (
            <StatusChip variant="healthy">{`${d.succeeded}/${d.completions}`}</StatusChip>
          ) : (
            `${d.succeeded || 0}/${d.completions}`
          ),
      },
      // Active/Failed counts — only when non-zero.
      {
        field: 'active',
        label: 'Active',
        hidden: (d) => !(d.active !== undefined && Number(d.active) > 0),
        render: (d) => <StatusChip variant="info">{d.active}</StatusChip>,
      },
      {
        field: 'failed',
        label: 'Failed',
        hidden: (d) => !(d.failed !== undefined && d.failed > 0),
        render: (d) => <StatusChip variant="unhealthy">{d.failed}</StatusChip>,
      },
      // Timeline.
      {
        field: 'startTime',
        label: 'Started',
        hidden: (d) => !normalizeTime(d.startTime),
        render: (d) => <TimestampValue value={d.startTime} />,
      },
      {
        field: 'completionTime',
        label: 'Completed',
        hidden: (d) => !normalizeTime(d.completionTime),
        render: (d) => <TimestampValue value={d.completionTime} />,
      },
      { field: 'duration', label: 'Duration', hidden: (d) => !d.duration },
      // Configuration — only show non-defaults.
      {
        field: 'parallelism',
        label: 'Parallelism',
        hidden: (d) => !(d.parallelism && d.parallelism > 1),
      },
      {
        field: 'backoffLimit',
        label: 'Backoff Limit',
        hidden: (d) => !(d.backoffLimit !== undefined && d.backoffLimit !== 6),
      },
      {
        field: 'completionMode',
        label: 'Completion Mode',
        hidden: (d) => !(d.completionMode && d.completionMode !== 'NonIndexed'),
        render: (d) => (
          <StatusChip
            variant="info"
            tooltip="Each pod gets a unique 0-based index (JOB_COMPLETION_INDEX env var) so completions can be partitioned across parallel pods."
          >
            {d.completionMode}
          </StatusChip>
        ),
      },
      {
        field: 'activeDeadlineSeconds',
        label: 'Active Deadline',
        hidden: (d) => !(d.activeDeadlineSeconds !== undefined && d.activeDeadlineSeconds > 0),
        render: (d) => `${d.activeDeadlineSeconds}s`,
      },
      {
        field: 'ttlSecondsAfterFinished',
        label: 'TTL Seconds',
        hidden: (d) => !(d.ttlSecondsAfterFinished !== undefined && d.ttlSecondsAfterFinished >= 0),
        render: (d) => `${d.ttlSecondsAfterFinished}s`,
      },
    ],
  },
  // Not surfaced in the Job Overview by design (matches JobOverview.tsx):
  // - statusState/statusPresentation/statusReason -> the Status chip uses `status`/`suspend` only
  // - details -> table-summary string
  // - containers/conditions/pods/podMetricsSummary -> Jobs have no Containers/Utilization section
  coveredElsewhere: [
    'statusState',
    'statusPresentation',
    'statusReason',
    'details',
    'containers',
    'conditions',
    'pods',
    'podMetricsSummary',
  ],
};

export const cronJobDescriptor: OverviewDescriptor<CronJobDetails> = {
  displayKind: 'CronJob',
  dtoClass: cronjob.CronJobDetails,
  schema: {
    items: [
      // Suspended state first.
      {
        field: 'suspend',
        label: 'Status',
        hidden: (d) => !d.suspend,
        render: (d) => (d.suspend ? <StatusChip variant="warning">Suspended</StatusChip> : null),
      },
      {
        field: 'schedule',
        label: 'Schedule',
        render: (d) => <code>{d.schedule}</code>,
      },
      // Concurrency policy — chip with tooltip when non-default.
      {
        field: 'concurrencyPolicy',
        label: 'Concurrency',
        hidden: (d) => !(d.concurrencyPolicy && d.concurrencyPolicy !== 'Allow'),
        render: (d) => (
          <StatusChip
            variant={concurrencyVariant(d.concurrencyPolicy)}
            tooltip={concurrencyTooltip(d.concurrencyPolicy)}
          >
            {d.concurrencyPolicy}
          </StatusChip>
        ),
      },
      {
        field: 'startingDeadlineSeconds',
        label: 'Start Deadline',
        hidden: (d) =>
          !(d.startingDeadlineSeconds !== undefined && d.startingDeadlineSeconds !== null),
        render: (d) => `${d.startingDeadlineSeconds}s`,
      },
      // Active runs.
      {
        field: 'activeJobs',
        label: 'Active Jobs',
        hidden: (d) => !(activeJobCount(d) > 0),
        render: (d) => <StatusChip variant="info">{activeJobCount(d)}</StatusChip>,
      },
      // Run-history timeline — visual strip of recent runs sized by
      // duration and colored by outcome. Rendered only when we have at
      // least one Job record to plot.
      {
        kind: 'widget',
        consumes: ['jobs'],
        render: (d, context) =>
          d.jobs && d.jobs.length > 0 ? (
            <OverviewItem
              label="History"
              fullWidth
              value={<CronJobHistory data={d} context={context} />}
            />
          ) : null,
      },
      // Run summary — collapses Next Scheduled, Last Scheduled, Last
      // Manual, Last Success, Last Failure into one labeled block. Last
      // Manual / Last Failure are bounded by Job retention; "—" can mean
      // either "never" or "older than the retained history" — the
      // tooltip clarifies.
      {
        kind: 'widget',
        consumes: [
          'suspend',
          'nextScheduleTime',
          'lastScheduleTime',
          'lastManualTime',
          'lastSuccessfulTime',
          'lastFailureTime',
        ],
        render: (d) => (
          <OverviewItem
            label="Runs"
            fullWidth
            value={
              <RunSummary
                suspend={d.suspend}
                nextScheduleTime={d.nextScheduleTime}
                lastScheduleTime={d.lastScheduleTime}
                lastManualTime={d.lastManualTime}
                lastSuccessfulTime={d.lastSuccessfulTime}
                lastFailureTime={d.lastFailureTime}
              />
            }
          />
        ),
      },
      // History retention — these are caps on how many old job records
      // to keep, not an outcome count. Render as-is when non-default
      // (k8s defaults are 3 / 1).
      {
        field: 'successfulJobsHistory',
        derivedFrom: ['failedJobsHistory'],
        label: 'History Limits',
        hidden: (d) =>
          !(
            (d.successfulJobsHistory !== undefined && d.successfulJobsHistory !== 3) ||
            (d.failedJobsHistory !== undefined && d.failedJobsHistory !== 1)
          ),
        render: (d) =>
          `${d.successfulJobsHistory ?? 3} succeeded, ${d.failedJobsHistory ?? 1} failed`,
      },
    ],
  },
  // Not surfaced in the CronJob Overview by design (matches JobOverview.tsx):
  // - status/statusState/statusPresentation/statusReason -> only the suspend chip is shown
  // - details -> table-summary string
  // - timeUntilNextSchedule -> Runs block derives "in X" from nextScheduleTime instead
  // - jobTemplate -> not surfaced
  // - pods/podMetricsSummary -> CronJobs have no Containers/Utilization section
  coveredElsewhere: [
    'status',
    'statusState',
    'statusPresentation',
    'statusReason',
    'details',
    'timeUntilNextSchedule',
    'jobTemplate',
    'pods',
    'podMetricsSummary',
  ],
};
