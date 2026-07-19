/**
 * frontend/src/core/refresh/client.ts
 *
 * Client helpers for client.
 * Handles API calls and response shaping for the core layer.
 */

import type { backend } from '@wailsjs/go/models';
import {
  GetKubernetesAPIClientDiagnostics,
  GetRefreshBaseURL,
  GetSelectionDiagnostics,
} from '@/core/backend-api';
import { formatPermissionDeniedStatus, isPermissionDeniedStatus } from './permissionErrors';
import {
  assertRefreshSnapshotEnvelope,
  assertTelemetrySummary,
  type RefreshDomain,
  type RefreshSnapshot,
  type SnapshotStats,
  type TelemetrySummary,
} from './types';

export type Snapshot<TPayload> = RefreshSnapshot<TPayload>;
export type { SnapshotStats };
export type NormalizedTelemetrySummary = Omit<TelemetrySummary, 'snapshots' | 'streams'> & {
  snapshots: NonNullable<TelemetrySummary['snapshots']>;
  streams: NonNullable<TelemetrySummary['streams']>;
};

export type SelectionDiagnostics = backend.SelectionDiagnostics;
export type KubernetesAPIClientDiagnostics = backend.KubernetesAPIClientDiagnostics;

interface FetchSnapshotOptions {
  scope?: string;
  signal?: AbortSignal;
  ifNoneMatch?: string;
  manual?: boolean;
}

type ManualRefreshJob = {
  jobId: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  error?: string;
};

let cachedRefreshBaseURL: string | null = null;
let refreshBaseURLPromise: Promise<string> | null = null;
let refreshReadyPromise: Promise<string> | null = null;

const REFRESH_NOT_READY_PATTERN = /refresh subsystem not initialised/i;
const MAX_REFRESH_URL_ATTEMPTS = 30;
const INITIAL_REFRESH_URL_DELAY_MS = 200;
const MANUAL_REFRESH_TIMEOUT_MS = 60_000;
const INITIAL_MANUAL_JOB_POLL_MS = 50;
const MAX_MANUAL_JOB_POLL_MS = 1_000;

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === 'string' ? error : 'Unknown error');
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const abortableDelay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Manual refresh aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('Manual refresh aborted', 'AbortError'));
    };
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

const parseManualRefreshJob = async (response: Response): Promise<ManualRefreshJob> => {
  if (!response.ok) {
    const { message } = await safeParseError(response);
    throw new Error(message);
  }
  const job = (await response.json()) as Partial<ManualRefreshJob>;
  if (!job.jobId || !job.state) {
    throw new Error('Manual refresh returned an invalid job');
  }
  return job as ManualRefreshJob;
};

const waitForManualRefresh = async (
  baseURL: string,
  domain: RefreshDomain,
  scope: string,
  signal?: AbortSignal
): Promise<void> => {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener('abort', onAbort, { once: true });
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MANUAL_REFRESH_TIMEOUT_MS);

  try {
    const enqueueURL = new URL(`/api/v2/refresh/${domain}`, baseURL);
    let job = await parseManualRefreshJob(
      await fetch(enqueueURL.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, reason: 'user' }),
        signal: controller.signal,
      })
    );
    let pollDelayMs = INITIAL_MANUAL_JOB_POLL_MS;
    while (job.state === 'queued' || job.state === 'running') {
      const statusURL = new URL(`/api/v2/jobs/${job.jobId}`, baseURL);
      job = await parseManualRefreshJob(
        await fetch(statusURL.toString(), { signal: controller.signal })
      );
      if (job.state === 'queued' || job.state === 'running') {
        await abortableDelay(pollDelayMs, controller.signal);
        pollDelayMs = Math.min(MAX_MANUAL_JOB_POLL_MS, pollDelayMs * 2);
      }
    }
    if (job.state === 'failed' || job.state === 'cancelled') {
      throw new Error(job.error || `Manual refresh failed for ${domain}`);
    }
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `Manual refresh timed out after ${MANUAL_REFRESH_TIMEOUT_MS / 1_000} seconds for ${domain}`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
};

async function attemptResolveRefreshBaseURL(attempt = 0): Promise<string> {
  try {
    const url = await GetRefreshBaseURL();
    if (!url) {
      throw new Error('refresh subsystem not initialised');
    }
    return url.endsWith('/') ? url.slice(0, -1) : url;
  } catch (error) {
    const resolvedError = toError(error);
    if (REFRESH_NOT_READY_PATTERN.test(resolvedError.message)) {
      if (attempt + 1 >= MAX_REFRESH_URL_ATTEMPTS) {
        throw resolvedError;
      }

      const delayMs = Math.min(1000, INITIAL_REFRESH_URL_DELAY_MS * 2 ** attempt);
      await delay(delayMs);
      return attemptResolveRefreshBaseURL(attempt + 1);
    }

    throw resolvedError;
  }
}

async function resolveRefreshBaseURL(): Promise<string> {
  if (cachedRefreshBaseURL) {
    return cachedRefreshBaseURL;
  }

  if (!refreshBaseURLPromise) {
    refreshBaseURLPromise = attemptResolveRefreshBaseURL()
      .then((url) => {
        cachedRefreshBaseURL = url;
        return url;
      })
      .catch((error) => {
        refreshBaseURLPromise = null;
        throw error;
      });
  }

  return refreshBaseURLPromise;
}

export async function ensureRefreshBaseURL(): Promise<string> {
  if (cachedRefreshBaseURL) {
    return cachedRefreshBaseURL;
  }

  if (!refreshReadyPromise) {
    refreshReadyPromise = resolveRefreshBaseURL().catch((error) => {
      refreshReadyPromise = null;
      throw error;
    });
  }

  return refreshReadyPromise;
}

export async function fetchSnapshot<TPayload>(
  domain: RefreshDomain,
  options: FetchSnapshotOptions = {}
): Promise<{ snapshot?: Snapshot<TPayload>; etag?: string; notModified: boolean }> {
  if (options.manual) {
    if (!options.scope) {
      throw new Error(`Manual refresh for ${domain} requires a cluster scope`);
    }
    await waitForManualRefresh(
      await resolveRefreshBaseURL(),
      domain,
      options.scope,
      options.signal
    );
  }
  const buildRequest = async () => {
    const baseURL = await resolveRefreshBaseURL();
    const url = new URL(`/api/v2/snapshots/${domain}`, baseURL);

    if (options.scope) {
      url.searchParams.set('scope', options.scope);
    }

    const headers: Record<string, string> = {};
    if (options.ifNoneMatch && !options.manual) {
      headers['If-None-Match'] = options.ifNoneMatch;
    }

    return fetch(url.toString(), {
      signal: options.signal,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    });
  };

  const isRetryableNetworkError = (error: unknown) => {
    if (options.signal?.aborted) {
      return false;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      return false;
    }
    if (error instanceof TypeError) {
      const message = error.message.toLowerCase();
      return message.includes('failed to fetch') || message.includes('load failed');
    }
    return false;
  };

  const maxAttempts = 3;
  let response: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      response = await buildRequest();
      break;
    } catch (error) {
      if (!isRetryableNetworkError(error) || attempt + 1 >= maxAttempts) {
        throw error;
      }
      // Refresh base URLs can change when the backend rebuilds the refresh subsystem.
      invalidateRefreshBaseURL();
      const delayMs = Math.min(1000, 200 * 2 ** attempt);
      await delay(delayMs);
    }
  }
  if (!response) {
    throw new Error('Snapshot request failed');
  }

  if (response.status === 304) {
    return { notModified: true };
  }

  if (!response.ok) {
    const { message, permissionDenied } = await safeParseError(response);
    throw permissionDenied ? new SnapshotPermissionDeniedError(message) : new Error(message);
  }

  const snapshot: unknown = await response.json();
  assertRefreshSnapshotEnvelope<TPayload>(snapshot, domain);
  return {
    snapshot,
    etag: response.headers.get('ETag') ?? undefined,
    notModified: false,
  };
}

// A snapshot request the backend refused for lack of RBAC permission. Typed
// so the orchestrator can mark the scope permissionDenied structurally and
// stop background retries (permission is checked ONCE per session — recovery
// is an app restart), without string-matching messages.
export class SnapshotPermissionDeniedError extends Error {
  readonly permissionDenied = true;
}

// Structural guard (marker property, not instanceof) so it survives module
// mocking and error re-wrapping.
export const isSnapshotPermissionDenied = (error: unknown): boolean =>
  error instanceof Error && (error as { permissionDenied?: boolean }).permissionDenied === true;

async function safeParseError(
  response: Response
): Promise<{ message: string; permissionDenied: boolean }> {
  try {
    const data = await response.json();
    if (isPermissionDeniedStatus(data)) {
      return { message: formatPermissionDeniedStatus(data), permissionDenied: true };
    }
    if (data?.message) {
      return { message: data.message as string, permissionDenied: false };
    }
  } catch (_) {
    // Ignore JSON parse errors and fall back to status text
  }
  return {
    message: `Snapshot request failed: ${response.status} ${response.statusText}`,
    permissionDenied: false,
  };
}

export function invalidateRefreshBaseURL(): void {
  cachedRefreshBaseURL = null;
  refreshBaseURLPromise = null;
  refreshReadyPromise = null;
}

export async function fetchTelemetrySummary(): Promise<NormalizedTelemetrySummary> {
  const baseURL = await resolveRefreshBaseURL();
  const url = new URL('/api/v2/telemetry/summary', baseURL);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Telemetry request failed: ${response.status} ${response.statusText}`);
  }

  const summary: unknown = await response.json();
  assertTelemetrySummary(summary);
  return {
    ...summary,
    snapshots: summary.snapshots ?? [],
    streams: summary.streams ?? [],
  };
}

export async function setMetricsActive(clusterIds: readonly string[]): Promise<void> {
  const baseURL = await resolveRefreshBaseURL();
  const url = new URL('/api/v2/metrics/active', baseURL);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clusterIds }),
  });
  if (!response.ok) {
    throw new Error(`Metrics activity request failed: ${response.status} ${response.statusText}`);
  }
}

export async function fetchSelectionDiagnostics(): Promise<SelectionDiagnostics> {
  return GetSelectionDiagnostics();
}

export async function fetchKubernetesAPIClientDiagnostics(): Promise<
  KubernetesAPIClientDiagnostics[]
> {
  return GetKubernetesAPIClientDiagnostics();
}
