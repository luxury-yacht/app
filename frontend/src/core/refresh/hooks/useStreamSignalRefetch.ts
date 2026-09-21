/**
 * frontend/src/core/refresh/hooks/useStreamSignalRefetch.ts
 *
 * Shared refetch-on-signal hook for consumers that read a stream-domain
 * scope's DATA from the store. Doorbells/change signals only advance the
 * scoped sourceVersion — they never fetch — and while a stream is healthy the
 * refresher skips its polls. Any data reader without this hook (or an
 * equivalent, like the query-backed tables' liveDataVersion identity) freezes.
 *
 * The refetch uses reason 'stream-signal', the one non-manual reason the
 * skip-while-stream-healthy gate never swallows (the signal IS the stream
 * announcing changed data). Auto-refresh pause still applies.
 *
 * Loop safety: the hook keys on the domain's DECLARED doorbell clocks
 * (contract sourceClocks) inside signalVersions — the field ONLY the stream
 * manager's doorbell path writes — NEVER the folded sourceVersion and NEVER
 * sourceVersions. Payload applies rewrite both of those on every fetch (the
 * backend back-fills an object clock into every snapshot), so keying on them
 * turned each fetch response into another "signal": a fetch storm during
 * cluster warm-up and a doubled (echo) fetch per doorbell in steady state —
 * both observed live. signalVersions moves exactly when a doorbell delivers
 * it, so the key is quiet between real signals. The first observed key per
 * scope is consumed without fetching (the scope's data was fetched at or
 * after those doorbells).
 */

import { useEffect, useRef } from 'react';

import { requestRefreshDomain } from '@/core/data-access';
import { useRefreshScopedDomainStates } from '../store';
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

export const useStreamSignalRefetch = (domain: RefreshDomain, scopes: readonly string[]): void => {
  const domainStates = useRefreshScopedDomainStates(domain);
  const dispatchedKeysRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const clocks = doorbellSourceClocks(domain);
    if (clocks.length === 0) {
      return;
    }
    scopes.forEach((scope) => {
      if (!scope) {
        return;
      }
      // signalVersions is written ONLY by the stream manager's doorbell path;
      // payload applies never touch it. Keying on it (never sourceVersions,
      // which the backend back-fills with an object clock on EVERY snapshot)
      // is what makes a fetch response invisible here — no echo refetch.
      const { key, present: hasSignal } = readDoorbellSignal(domain, domainStates[scope] ?? {});
      const dispatched = dispatchedKeysRef.current;
      if (!dispatched.has(scope)) {
        // First observation: whatever doorbell values exist arrived before
        // this consumer mounted — the data it reads was fetched at or after
        // them, fresh by construction.
        dispatched.set(scope, key);
        return;
      }
      if (dispatched.get(scope) === key || !hasSignal) {
        return;
      }
      dispatched.set(scope, key);
      // The runtime retains failed reconciliation and owns its retry backoff.
      void requestRefreshDomain({ domain, scope, reason: 'stream-signal' });
    });
  }, [domainStates, scopes, domain]);
};
