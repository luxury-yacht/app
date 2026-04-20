import { useSyncExternalStore } from 'react';

import type { AppStateAdapter } from '@/core/app-state-access';
import type { DataAccessAdapter, DataRequestReason } from '@/core/data-access';

type Listener = () => void;

export type BrokerKind = 'data-access' | 'app-state-access';
export type BrokerAdapter = DataAccessAdapter | AppStateAdapter;
export type BrokerRequestStatus = 'success' | 'error' | 'blocked';

export interface BrokerReadDiagnosticsEntry {
  key: string;
  broker: BrokerKind;
  resource: string;
  adapter: BrokerAdapter;
  reason?: DataRequestReason;
  totalRequests: number;
  inFlightCount: number;
  successCount: number;
  errorCount: number;
  blockedCount: number;
  lastStatus: BrokerRequestStatus | 'never';
  lastStartedAt?: number;
  lastCompletedAt?: number;
  lastDurationMs?: number;
  lastBlockedReason?: string | null;
  lastError?: string | null;
}

interface BeginBrokerReadOptions {
  broker: BrokerKind;
  resource: string;
  adapter: BrokerAdapter;
  reason?: DataRequestReason;
}

interface CompleteBrokerReadOptions {
  token: string;
  status: BrokerRequestStatus;
  blockedReason?: string;
  error?: unknown;
}

interface PendingBrokerRead extends BeginBrokerReadOptions {
  startedAt: number;
}

const listeners = new Set<Listener>();
const entries = new Map<string, BrokerReadDiagnosticsEntry>();
const pendingReads = new Map<string, PendingBrokerRead>();
let snapshotCache: BrokerReadDiagnosticsEntry[] = [];
let snapshotDirty = true;
let requestSequence = 0;

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = () => {
  snapshotDirty = true;
  if (listeners.size === 0) {
    return;
  }
  for (const listener of listeners) {
    listener();
  }
};

const buildKey = ({ broker, resource, adapter, reason }: BeginBrokerReadOptions): string => {
  return [broker, resource, adapter, reason ?? ''].join('::');
};

const getOrCreateEntry = (options: BeginBrokerReadOptions): BrokerReadDiagnosticsEntry => {
  const key = buildKey(options);
  const existing = entries.get(key);
  if (existing) {
    return existing;
  }

  const entry: BrokerReadDiagnosticsEntry = {
    key,
    broker: options.broker,
    resource: options.resource,
    adapter: options.adapter,
    reason: options.reason,
    totalRequests: 0,
    inFlightCount: 0,
    successCount: 0,
    errorCount: 0,
    blockedCount: 0,
    lastStatus: 'never',
    lastBlockedReason: null,
    lastError: null,
  };
  entries.set(key, entry);
  return entry;
};

const normalizeError = (error: unknown): string | null => {
  if (error == null) {
    return null;
  }
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
};

export const beginBrokerRead = (options: BeginBrokerReadOptions): string => {
  const entry = getOrCreateEntry(options);
  const startedAt = Date.now();
  entry.totalRequests += 1;
  entry.inFlightCount += 1;
  entry.lastStartedAt = startedAt;
  entry.lastBlockedReason = null;
  entry.lastError = null;

  const token = `broker-read-${(requestSequence += 1)}`;
  pendingReads.set(token, {
    ...options,
    startedAt,
  });
  notify();
  return token;
};

export const completeBrokerRead = ({
  token,
  status,
  blockedReason,
  error,
}: CompleteBrokerReadOptions): void => {
  const pending = pendingReads.get(token);
  if (!pending) {
    return;
  }
  pendingReads.delete(token);

  const entry = getOrCreateEntry(pending);
  entry.inFlightCount = Math.max(entry.inFlightCount - 1, 0);
  entry.lastCompletedAt = Date.now();
  entry.lastDurationMs = Math.max(0, entry.lastCompletedAt - pending.startedAt);
  entry.lastStatus = status;

  if (status === 'success') {
    entry.successCount += 1;
    entry.lastBlockedReason = null;
    entry.lastError = null;
  } else if (status === 'blocked') {
    entry.blockedCount += 1;
    entry.lastBlockedReason = blockedReason ?? null;
    entry.lastError = null;
  } else {
    entry.errorCount += 1;
    entry.lastBlockedReason = null;
    entry.lastError = normalizeError(error);
  }

  notify();
};

export const recordBlockedBrokerRead = (
  options: BeginBrokerReadOptions,
  blockedReason: string
): void => {
  const entry = getOrCreateEntry(options);
  entry.totalRequests += 1;
  entry.blockedCount += 1;
  entry.lastStatus = 'blocked';
  entry.lastCompletedAt = Date.now();
  entry.lastDurationMs = 0;
  entry.lastBlockedReason = blockedReason;
  entry.lastError = null;
  notify();
};

export const getBrokerReadDiagnosticsSnapshot = (): BrokerReadDiagnosticsEntry[] => {
  if (!snapshotDirty) {
    return snapshotCache;
  }

  snapshotCache = Array.from(entries.values())
    .map((entry) => ({ ...entry }))
    .sort((left, right) => {
      if (left.inFlightCount !== right.inFlightCount) {
        return right.inFlightCount - left.inFlightCount;
      }
      if (left.broker !== right.broker) {
        return left.broker.localeCompare(right.broker);
      }
      if (left.resource !== right.resource) {
        return left.resource.localeCompare(right.resource);
      }
      return left.key.localeCompare(right.key);
    });
  snapshotDirty = false;
  return snapshotCache;
};

export const useBrokerReadDiagnostics = (): BrokerReadDiagnosticsEntry[] =>
  useSyncExternalStore(
    subscribe,
    getBrokerReadDiagnosticsSnapshot,
    getBrokerReadDiagnosticsSnapshot
  );

export const resetBrokerReadDiagnosticsForTesting = (): void => {
  listeners.clear();
  entries.clear();
  pendingReads.clear();
  snapshotCache = [];
  snapshotDirty = true;
  requestSequence = 0;
};
