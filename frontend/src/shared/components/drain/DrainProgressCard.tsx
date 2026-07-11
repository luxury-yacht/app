/**
 * frontend/src/shared/components/drain/DrainProgressCard.tsx
 *
 * Renders a single drain job as a progress card: status header, summary line,
 * progress bar, per-pod table, and a collapsible raw event log. Used inside
 * DrainNodeModal for both the active drain (with cancel control) and a
 * just-finished historical job.
 */

import { assertNever } from '@shared/utils/assertNever';
import { useEffect, useMemo, useState } from 'react';
import type { NodeMaintenanceDrainJob } from '@/core/refresh/types';
import {
  type DrainPhase,
  type DrainPodProgress,
  type DrainPodStatus,
  type DrainProgress,
  deriveDrainProgress,
} from './drainProgress';
import './DrainProgressCard.css';

type DrainJobStatus = NodeMaintenanceDrainJob['status'];

interface DrainProgressCardProps {
  job: NodeMaintenanceDrainJob;
  isActive: boolean;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  cancelDisabledReason?: string | null;
}

const ACTIVE_STATUSES: ReadonlySet<DrainJobStatus> = new Set<DrainJobStatus>([
  'running',
  'canceling',
]);

export function DrainProgressCard({
  job,
  isActive,
  onCancel,
  cancelDisabled,
  cancelDisabledReason,
}: DrainProgressCardProps) {
  const progress = useMemo(() => deriveDrainProgress(job), [job]);
  const [now, setNow] = useState(() => Date.now());
  const showCancel = ACTIVE_STATUSES.has(job.status) && Boolean(onCancel);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(progress.hasError);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isActive]);

  useEffect(() => {
    if (progress.hasError) {
      setDetailsOpen(true);
    }
  }, [progress.hasError]);

  const elapsedMs = (progress.completedAt ?? now) - progress.startedAt;
  const timeoutMs = progress.timeoutSeconds ? progress.timeoutSeconds * 1000 : undefined;

  return (
    <div className="drain-progress-card">
      <div className="drain-progress-card-header">
        <span className={`status-text ${getStatusClass(job.status)}`} data-test="drain-job-status">
          {getStatusLabel(job.status)}
        </span>
        <div className="drain-progress-card-meta">
          <span>Started {formatTimestamp(progress.startedAt)}</span>
          <span data-test="drain-elapsed">
            {progress.completedAt
              ? `Duration ${formatElapsed(elapsedMs)}`
              : `Elapsed ${formatElapsed(elapsedMs)}${
                  timeoutMs ? ` / ${formatElapsed(timeoutMs)}` : ''
                }`}
          </span>
          <span>{phaseLabel(progress.phase, isActive)}</span>
        </div>
        {!!showCancel && (
          <button
            type="button"
            className="button warning"
            onClick={onCancel}
            disabled={cancelDisabled || job.status === 'canceling'}
            title={cancelDisabledReason ?? undefined}
            data-maintenance-action="cancel-drain"
          >
            {job.status === 'canceling' || (cancelDisabled && !cancelDisabledReason)
              ? 'Canceling…'
              : 'Cancel Drain'}
          </button>
        )}
      </div>

      <div className="drain-progress-summary" data-test="drain-progress-summary">
        {summaryLine(progress, Boolean(job.options?.disableEviction))}
      </div>

      <ProgressBar progress={progress} />

      {!!(progress.hasError && progress.errorMessage) && (
        <div className="drain-progress-error" role="alert">
          {progress.errorMessage}
        </div>
      )}

      {!progress.hasError && progress.completedAt && job.message && (
        <p className="drain-progress-helper">{job.message}</p>
      )}

      {progress.pods.length > 0 && <PodTable pods={progress.pods} />}

      {job.events && job.events.length > 0 && (
        <details
          className="drain-progress-card-details"
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary>
            {detailsOpen ? 'Hide' : 'Show'} event log ({job.events.length})
          </summary>
          <ul className="drain-progress-events">
            {job.events.map((event) => (
              <li
                key={event.id}
                className={`drain-progress-event${event.kind === 'error' ? ' error' : ''}`}
              >
                <span className="drain-progress-event-time">
                  {formatTimestamp(event.timestamp)}
                </span>
                <span className="drain-progress-event-label">{event.phase || event.kind}</span>
                <span className="drain-progress-event-message">
                  {event.podNamespace && event.podName
                    ? `${event.podNamespace}/${event.podName}${
                        event.message ? ` – ${event.message}` : ''
                      }`
                    : event.message || '—'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ProgressBar({ progress }: { progress: DrainProgress }) {
  const denominator = Math.max(progress.totalPlanned ?? 0, progress.totalSeen, 1);
  const donePct = (progress.done / denominator) * 100;
  const failedPct = (progress.failed / denominator) * 100;
  const inProgressPct = (progress.inProgress / denominator) * 100;
  return (
    <div
      className="drain-progress-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={denominator}
      aria-valuenow={progress.done + progress.failed}
    >
      <div className="segment done" style={{ width: `${donePct}%` }} />
      <div className="segment failed" style={{ width: `${failedPct}%` }} />
      <div className="segment in-progress" style={{ width: `${inProgressPct}%` }} />
    </div>
  );
}

function PodTable({ pods }: { pods: DrainPodProgress[] }) {
  return (
    <table className="drain-progress-pod-table" data-test="drain-pod-table">
      <colgroup>
        <col className="col-pod" />
        <col className="col-status" />
      </colgroup>
      <thead>
        <tr>
          <th>Pod</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {pods.map((pod) => (
          <tr key={pod.key}>
            <td className="pod-name">
              <span className="namespace">{pod.namespace}</span>
              <span className="separator">/</span>
              <span className="name">{pod.name}</span>
            </td>
            <td>
              <span className={`status-text ${podStatusClass(pod.status)}`}>
                {podStatusLabel(pod.status)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function summaryLine(progress: DrainProgress, usingDelete: boolean): string {
  const verb = usingDelete ? 'deleted' : 'evicted';
  const total = progress.totalPlanned;
  const seen = progress.totalSeen;
  const head =
    total !== null && total !== undefined
      ? `${progress.done} of ${total} pods ${verb}`
      : seen > 0
        ? `${progress.done} of ${seen} pods ${verb}`
        : 'Preparing drain…';
  const parts: string[] = [head];
  if (progress.inProgress > 0) {
    parts.push(`${progress.inProgress} in progress`);
  }
  if (progress.failed > 0) {
    parts.push(`${progress.failed} failed`);
  }
  return parts.join(' · ');
}

function getStatusClass(status: DrainJobStatus): string {
  switch (status) {
    case 'running':
      return 'info';
    case 'canceling':
    case 'cancelled':
      return 'warning';
    case 'failed':
      return 'error';
    case 'succeeded':
      return 'success';
    default:
      return assertNever(status, 'drain job status');
  }
}

function getStatusLabel(status: DrainJobStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'canceling':
      return 'Canceling';
    case 'cancelled':
      return 'Cancelled';
    case 'failed':
      return 'Failed';
    case 'succeeded':
      return 'Completed';
    default:
      return assertNever(status, 'drain job status');
  }
}

function podStatusClass(status: DrainPodStatus): string {
  switch (status) {
    case 'in-progress':
      return 'info';
    case 'failed':
      return 'error';
    default:
      return 'success';
  }
}

function podStatusLabel(status: DrainPodStatus): string {
  switch (status) {
    case 'in-progress':
      return 'In progress';
    case 'failed':
      return 'Failed';
    default:
      return 'Done';
  }
}

function phaseLabel(phase: DrainPhase, isActive: boolean): string {
  if (!isActive) {
    return phase === 'completed' ? 'Finished' : capitalize(phase);
  }
  switch (phase) {
    case 'pending':
      return 'Queued';
    case 'cordoning':
      return 'Cordoning node';
    case 'planning':
      return 'Planning evictions';
    case 'evicting':
      return 'Evicting pods';
    case 'waiting':
      return 'Waiting for termination';
    case 'completed':
      return 'Finishing';
    default:
      return capitalize(phase);
  }
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatTimestamp(value?: number | null): string {
  if (!value || Number.isNaN(value)) {
    return '—';
  }
  return new Date(value).toLocaleString();
}

function formatElapsed(deltaMs: number): string {
  const delta = Math.max(0, deltaMs);
  if (delta < 1000) {
    return `${delta}ms`;
  }
  const totalSeconds = Math.floor(delta / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}:${remMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
