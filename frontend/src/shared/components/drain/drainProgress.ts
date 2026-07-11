/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Maintenance/drainProgress.ts
 *
 * Derives a progress-shaped view-model from a NodeMaintenanceDrainJob. The
 * backend emits a flat event stream — this helper rolls that stream up into
 * counts, per-pod rows, and a coarse phase so the UI can show a real progress
 * indicator instead of just a raw event log.
 */

import type {
  DrainEventPhase,
  NodeMaintenanceDrainEvent,
  NodeMaintenanceDrainJob,
} from '@/core/refresh/types';

export type DrainPodStatus = 'in-progress' | 'done' | 'failed';

export interface DrainPodProgress {
  key: string;
  namespace: string;
  name: string;
  status: DrainPodStatus;
  startedAt?: number;
  completedAt?: number;
  message?: string;
}

export type DrainPhase =
  | 'pending'
  | 'cordoning'
  | 'planning'
  | 'evicting'
  | 'waiting'
  | 'completed';

export interface DrainProgress {
  /** Total pods reported by the "plan" event, when present. */
  totalPlanned?: number;
  /** Pods seen via pod-events; >= totalPlanned is possible if plan is missing. */
  totalSeen: number;
  inProgress: number;
  done: number;
  failed: number;
  /** Sorted: in-progress first, then failed, then done. */
  pods: DrainPodProgress[];
  phase: DrainPhase;
  /** Timestamp of the most recent event. */
  lastActivity?: number;
  hasError: boolean;
  /** Latest error message (info or pod kind=error), if any. */
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
  /** Drain timeout in seconds, copied from job options for convenience. */
  timeoutSeconds?: number;
}

const PLAN_PHASE: DrainEventPhase = 'plan';
const POD_STARTED_PHASES: ReadonlySet<DrainEventPhase> = new Set<DrainEventPhase>([
  'evicting',
  'deleting',
]);
const POD_FINISHED_PHASES: ReadonlySet<DrainEventPhase> = new Set<DrainEventPhase>([
  'evicted',
  'deleted',
]);
const POD_ERROR_PHASES: ReadonlySet<DrainEventPhase> = new Set<DrainEventPhase>([
  'evict-error',
  'delete-error',
]);

const PLAN_COUNT_PATTERN = /(\d+)\s+pods?/i;

const STATUS_RANK: Record<DrainPodStatus, number> = {
  'in-progress': 0,
  failed: 1,
  done: 2,
};

/**
 * Parses a "plan" event message such as "Evicting 12 pods" into its count.
 * Returns undefined if the message does not match the expected shape.
 */
export function parsePlanCount(message?: string): number | undefined {
  if (!message) {
    return undefined;
  }
  const match = PLAN_COUNT_PATTERN.exec(message);
  if (!match) {
    return undefined;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : undefined;
}

function podKey(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

/**
 * Collapses a job's event stream into a per-pod progress map. Later events
 * for the same pod overwrite earlier state — eviction/deletion can transition
 * `in-progress -> done` or `in-progress -> failed`.
 */
function rollupPods(events: NodeMaintenanceDrainEvent[]): Map<string, DrainPodProgress> {
  const pods = new Map<string, DrainPodProgress>();
  for (const event of events) {
    const namespace = event.podNamespace?.trim();
    const name = event.podName?.trim();
    if (!namespace || !name) {
      continue;
    }
    const key = podKey(namespace, name);
    const existing = pods.get(key) ?? {
      key,
      namespace,
      name,
      status: 'in-progress' as DrainPodStatus,
    };
    const phase = event.phase;

    if (phase && POD_STARTED_PHASES.has(phase)) {
      existing.status = 'in-progress';
      existing.startedAt = existing.startedAt ?? event.timestamp;
      existing.message = event.message;
    } else if (phase && POD_FINISHED_PHASES.has(phase)) {
      existing.status = 'done';
      existing.completedAt = event.timestamp;
      existing.message = event.message;
    } else if ((phase && POD_ERROR_PHASES.has(phase)) || event.kind === 'error') {
      existing.status = 'failed';
      existing.completedAt = event.timestamp;
      existing.message = event.message;
    } else {
      existing.message = event.message ?? existing.message;
    }
    pods.set(key, existing);
  }
  return pods;
}

/**
 * Determines which lifecycle bucket the job is currently in based on the
 * highest-priority phase observed in the event stream.
 */
function derivePhase(events: NodeMaintenanceDrainEvent[], isTerminal: boolean): DrainPhase {
  if (isTerminal) {
    return 'completed';
  }
  let phase: DrainPhase = 'pending';
  for (const event of events) {
    switch (event.phase) {
      case 'cordon':
        if (phase === 'pending') {
          phase = 'cordoning';
        }
        break;
      case PLAN_PHASE:
        phase = 'planning';
        break;
      case 'evicting':
      case 'deleting':
      case 'skip-wait':
        phase = 'evicting';
        break;
      case 'wait':
        phase = 'waiting';
        break;
      case 'wait-complete':
      case 'completed':
        phase = 'completed';
        break;
      default:
        break;
    }
  }
  return phase;
}

export function deriveDrainProgress(job: NodeMaintenanceDrainJob): DrainProgress {
  const events = job.events ?? [];
  const isTerminal =
    job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';

  const podsMap = rollupPods(events);
  const pods = Array.from(podsMap.values()).sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) {
      return rank;
    }
    return a.key.localeCompare(b.key);
  });

  let inProgress = 0;
  let done = 0;
  let failed = 0;
  for (const pod of pods) {
    if (pod.status === 'in-progress') {
      inProgress += 1;
    } else if (pod.status === 'done') {
      done += 1;
    } else {
      failed += 1;
    }
  }

  const planEvent = [...events].reverse().find((e) => e.phase === PLAN_PHASE);
  const totalPlanned = parsePlanCount(planEvent?.message);

  let lastActivity: number | undefined;
  let hasError = false;
  let errorMessage: string | undefined;
  for (const event of events) {
    if (lastActivity === null || lastActivity === undefined || event.timestamp > lastActivity) {
      lastActivity = event.timestamp;
    }
    if (event.kind === 'error' || event.phase === 'error') {
      hasError = true;
      errorMessage = event.message ?? errorMessage;
    }
  }
  if (job.status === 'failed') {
    hasError = true;
    errorMessage = errorMessage ?? job.message;
  }

  return {
    totalPlanned,
    totalSeen: pods.length,
    inProgress,
    done,
    failed,
    pods,
    phase: derivePhase(events, isTerminal),
    lastActivity,
    hasError,
    errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    timeoutSeconds: job.options?.timeoutSeconds,
  };
}
