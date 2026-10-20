/**
 * frontend/src/core/refresh/hooks/useQueryStreamSignal.ts
 *
 * Signal identity for query-backed readers. Doorbells only advance a scope's
 * declared signal clocks; the orchestrator refetches snapshot leases itself,
 * but a query page belongs to its consumer, which refetches when the identity
 * below changes (useQueryStreamSignal).
 *
 * Loop safety: the identity keys on the domain's DECLARED doorbell clocks
 * (contract sourceClocks) inside signalVersions — the field ONLY the stream
 * manager's doorbell path writes — NEVER the folded sourceVersion and NEVER
 * sourceVersions. Payload applies rewrite both of those on every fetch (the
 * backend back-fills an object clock into every snapshot), so keying on them
 * would turn each fetch response into another "signal".
 */

import { useEffect, useRef } from 'react';

import { doorbellSourceClocks } from '../streaming/resourceStreamDomains';
import type { RefreshDomain } from '../types';

interface StreamSignalState {
  sourceVersion?: string;
  signalVersions?: Partial<Record<string, string>>;
  version?: number | string;
  checksum?: string;
  etag?: string;
  streamRevision?: number;
  streamAcknowledgedVersion?: number;
  queryReconcileVersion?: number;
  lastUpdated?: number;
  lastAutoRefresh?: number;
  lastManualRefresh?: number;
}

const readDoorbellSignal = (domain: RefreshDomain, state: StreamSignalState) => {
  const clocks = doorbellSourceClocks(domain);
  return {
    key: clocks.map((clock) => `${clock}:${state.signalVersions?.[clock] ?? ''}`).join(' '),
    present: clocks.some((clock) => Boolean(state.signalVersions?.[clock])),
  };
};

// Query demand also reconciles subscription acknowledgements and stream-down
// fallback ticks. Payload validators never invalidate a doorbell-backed page.
export const liveDomainVersion = (domain: RefreshDomain, state: StreamSignalState): string => {
  const queryReconcileIdentity =
    state.queryReconcileVersion === undefined
      ? ''
      : `query-reconcile:${state.queryReconcileVersion}`;
  if (doorbellSourceClocks(domain).length === 0) {
    return [state.sourceVersion ?? state.etag ?? '', queryReconcileIdentity]
      .filter(Boolean)
      .join(' ');
  }
  return [
    readDoorbellSignal(domain, state).key,
    state.streamAcknowledgedVersion === undefined
      ? ''
      : `stream-ack:${state.streamAcknowledgedVersion}`,
    queryReconcileIdentity,
  ]
    .filter(Boolean)
    .join(' ');
};

// Declarative queries use the returned identity in their request effect.
// Imperative queries supply their current-page reconciliation callback instead.
export function useQueryStreamSignal(
  domain: RefreshDomain,
  state: StreamSignalState,
  onSignal?: () => void,
  enabled = true
): string {
  const identity = liveDomainVersion(domain, state);
  const observedRef = useRef<string | null>(null);
  const hasSignal =
    readDoorbellSignal(domain, state).present ||
    state.streamAcknowledgedVersion !== undefined ||
    state.queryReconcileVersion !== undefined;
  useEffect(() => {
    const previous = observedRef.current;
    observedRef.current = identity;
    if (enabled && hasSignal && previous !== null && previous !== identity) {
      onSignal?.();
    }
  }, [enabled, hasSignal, identity, onSignal]);
  return identity;
}
