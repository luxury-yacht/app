/**
 * frontend/src/core/refresh/client.ts
 *
 * Client helpers for client.
 * Handles API calls and response shaping for the core layer.
 */

import { GetRefreshBaseURL } from '@wailsjs/go/backend/App';

import type { TelemetrySummary } from './types';
import { formatPermissionDeniedStatus, isPermissionDeniedStatus } from './permissionErrors';

export interface SnapshotStats {
  itemCount: number;
  buildDurationMs: number;
  totalItems?: number;
  truncated?: boolean;
  warnings?: string[];
  batchIndex?: number;
  batchSize?: number;
  totalBatches?: number;
  isFinalBatch?: boolean;
  timeToFirstBatchMs?: number;
  timeToFirstRowMs?: number;
  buildStartedAtUnix?: number;
}

export interface Snapshot<TPayload> {
  domain: string;
  scope?: string;
  version: number;
  checksum?: string;
  generatedAt: number;
  sequence: number;
  payload: TPayload;
  stats: SnapshotStats;
}

interface FetchSnapshotOptions {
  scope?: string;
  signal?: AbortSignal;
  ifNoneMatch?: string;
}

let cachedRefreshBaseURL: string | null = null;
let refreshBaseURLPromise: Promise<string> | null = null;
let refreshReadyPromise: Promise<string> | null = null;

const REFRESH_NOT_READY_PATTERN = /refresh subsystem not initialised/i;
const MAX_REFRESH_URL_ATTEMPTS = 30;
const INITIAL_REFRESH_URL_DELAY_MS = 200;

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === 'string' ? error : 'Unknown error');
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  domain: string,
  options: FetchSnapshotOptions = {}
): Promise<{ snapshot?: Snapshot<TPayload>; etag?: string; notModified: boolean }> {
  const buildRequest = async () => {
    const baseURL = await resolveRefreshBaseURL();
    const url = new URL(`/api/v2/snapshots/${domain}`, baseURL);

    if (options.scope) {
      url.searchParams.set('scope', options.scope);
    }

    const headers: Record<string, string> = {};
    if (options.ifNoneMatch) {
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
    const message = await safeParseError(response);
    throw new Error(message);
  }

  const snapshot = (await response.json()) as Snapshot<TPayload>;
  return {
    snapshot,
    etag: response.headers.get('ETag') ?? undefined,
    notModified: false,
  };
}

async function safeParseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (isPermissionDeniedStatus(data)) {
      return formatPermissionDeniedStatus(data);
    }
    if (data?.message) {
      return data.message as string;
    }
  } catch (_) {
    // Ignore JSON parse errors and fall back to status text
  }
  return `Snapshot request failed: ${response.status} ${response.statusText}`;
}

export function invalidateRefreshBaseURL(): void {
  cachedRefreshBaseURL = null;
  refreshBaseURLPromise = null;
  refreshReadyPromise = null;
}

export async function fetchTelemetrySummary(): Promise<TelemetrySummary> {
  const baseURL = await resolveRefreshBaseURL();
  const url = new URL('/api/v2/telemetry/summary', baseURL);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Telemetry request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as TelemetrySummary;
}

export async function setMetricsActive(active: boolean): Promise<void> {
  const baseURL = await resolveRefreshBaseURL();
  const url = new URL('/api/v2/metrics/active', baseURL);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  });
  if (!response.ok) {
    throw new Error(`Metrics activity request failed: ${response.status} ${response.statusText}`);
  }
}
