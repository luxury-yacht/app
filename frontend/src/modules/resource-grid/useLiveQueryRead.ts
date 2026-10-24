/**
 * frontend/src/modules/resource-grid/useLiveQueryRead.ts
 *
 * Query readers kept current the way query-backed tables keep their page.
 * useLiveScope leases a domain's base scope, whose stream signals changes
 * (`liveDataVersion` from useQueryStreamSignal). useLiveQueryRead reads one
 * query whole, without paging, once per scope and again on each signal; the
 * query itself never joins the stream, and its result stays in the refresh
 * store under its scope, so a remounted view shows it at once.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type DataRequestReason, useRefreshDomainHandle } from '@/core/data-access';
import { useRefreshScopedDomain } from '@/core/refresh';
import { useQueryStreamSignal } from '@/core/refresh/hooks/useQueryStreamSignal';
import { type RefreshFailure, refreshFailureOf } from '@/core/refresh/refreshFailure';
import type { DomainPayloadMap, RefreshDomain } from '@/core/refresh/types';
import { executeQueryPageRequest, failureOfState } from './queryPageRequest';
import { isLiveDomainInitialLoadPending } from './useQueryBackedResourceGridTable';

// Like typed queries: a read that comes back empty is retried after this long.
export const QUERY_WARMUP_RETRY_MS = 1000;

interface LiveScopeOptions<K extends RefreshDomain> {
  domain: K;
  /** The domain's base scope ('' leases nothing). */
  scope: string;
  enabled: boolean;
  /** Called on each change the live scope signals (useQueryStreamSignal). */
  onSignal?: () => void;
}

/**
 * Leases a domain's base scope for its change signals (demand 'query': no
 * snapshot read). `ready` once the lease has taken effect and the scope is not
 * waiting for its stream to start, so a first read does not go out before the
 * subscription is sent or while its cluster is still warming up. The
 * subscription's acknowledgement then signals one more read, which closes the
 * subscribe race (docs/architecture/data-freshness.md).
 */
export function useLiveScope<K extends RefreshDomain>({
  domain,
  scope,
  enabled,
  onSignal,
}: LiveScopeOptions<K>) {
  const leasing = enabled && Boolean(scope);
  const { state } = useRefreshDomainHandle<K>({
    domain: leasing ? domain : null,
    scope,
    enabled: leasing,
    preserveState: true,
    demand: 'query',
    fetchOnEnable: false,
  });
  const liveDataVersion = useQueryStreamSignal(domain, state, onSignal, leasing);
  // A render sees the scope before its lease's effect has run.
  const [leasedScope, setLeasedScope] = useState<string | null>(null);
  useEffect(() => {
    setLeasedScope(leasing ? scope : null);
  }, [leasing, scope]);
  const ready = leasing && leasedScope === scope && !isLiveDomainInitialLoadPending(state);
  return { state, liveDataVersion, ready };
}

interface LiveQueryReadOptions<K extends RefreshDomain> {
  domain: K;
  scope: string;
  enabled: boolean;
  /** The live scope's signal identity; each change re-reads the query. */
  liveDataVersion: string;
  label?: string;
  /**
   * Why the view reads: 'user' for a view the user opened (as typed tables
   * read), 'startup' for passive reads that pause with auto-refresh.
   */
  reason?: DataRequestReason;
}

export interface LiveQueryRead<P> {
  /** The scope's latest payload; a failed re-read keeps it. */
  payload: P | null;
  /** The scope's latest failure. */
  failure: RefreshFailure | null;
}

/**
 * A query's reads. Its first read is 'reading' until a result or failure
 * lands; 'warmup' when it came back empty, which the next signal reads again,
 * as does a timed retry while the cluster is not serviceable yet (a paused read
 * waits for the signal that resuming brings).
 */
export type QueryReadPhase = 'reading' | 'warmup' | 'landed';

interface ScopeReads {
  scope: string;
  version: string;
  phase: QueryReadPhase;
  inFlight: boolean;
  /** A signal arrived during a read; read once more when it settles. */
  pending: boolean;
  retry: number | null;
}

const startScopeReads = (
  previous: ScopeReads | null,
  scope: string,
  version: string
): ScopeReads => {
  if (previous && previous.retry !== null) {
    window.clearTimeout(previous.retry);
  }
  return { scope, version, phase: 'reading', inFlight: false, pending: false, retry: null };
};

// Whether a new live version should read now. A version that arrives during a
// read, the first one included, is latched for one more read: the read may
// have captured the object before the change.
const takesVersion = (reads: ScopeReads, version: string): boolean => {
  if (reads.version === version) {
    return false;
  }
  reads.version = version;
  if (reads.inFlight) {
    reads.pending = true;
    return false;
  }
  return true;
};

export function useLiveQueryRead<K extends RefreshDomain>({
  domain,
  scope,
  enabled,
  liveDataVersion,
  label,
  reason = 'user',
}: LiveQueryReadOptions<K>): LiveQueryRead<DomainPayloadMap[K]> {
  const state = useRefreshScopedDomain(domain, scope);
  // A read the refresh layer could not settle into the scope's state.
  const [thrown, setThrown] = useState<{ scope: string; failure: RefreshFailure } | null>(null);
  const readsRef = useRef<ScopeReads | null>(null);

  const read = useCallback(
    (reads: ScopeReads) => {
      reads.inFlight = true;
      const isCurrent = () => readsRef.current === reads;
      const warmUp = (retry: boolean) => {
        if (reads.phase === 'landed') {
          return;
        }
        reads.phase = 'warmup';
        if (!retry) {
          return;
        }
        reads.retry ??= window.setTimeout(() => {
          reads.retry = null;
          if (isCurrent() && reads.phase === 'warmup' && !reads.inFlight) {
            read(reads);
          }
        }, QUERY_WARMUP_RETRY_MS);
      };
      void executeQueryPageRequest(
        { domain, scope: reads.scope, label, reason, preserveState: true },
        {
          isCurrent,
          onResult: (result) => {
            setThrown(null);
            const landed =
              result.status === 'executed' &&
              Boolean(result.data?.data || failureOfState(result.data));
            if (landed) {
              reads.phase = 'landed';
            } else {
              warmUp(result.status === 'executed');
            }
          },
          onError: (error) => {
            reads.phase = 'landed';
            setThrown({ scope: reads.scope, failure: refreshFailureOf(error) });
          },
          onSettled: () => {
            reads.inFlight = false;
            if (reads.pending && isCurrent()) {
              reads.pending = false;
              read(reads);
            }
          },
        }
      );
    },
    [domain, label, reason]
  );

  useEffect(() => {
    if (!enabled || !scope) {
      return;
    }
    const reads = readsRef.current;
    if (reads?.scope !== scope) {
      const next = startScopeReads(reads, scope, liveDataVersion);
      readsRef.current = next;
      read(next);
      return;
    }
    if (takesVersion(reads, liveDataVersion)) {
      read(reads);
    }
  }, [enabled, liveDataVersion, read, scope]);

  useEffect(
    () => () => {
      const reads = readsRef.current;
      if (reads && reads.retry !== null) {
        window.clearTimeout(reads.retry);
        reads.retry = null;
      }
    },
    []
  );

  return {
    payload: (state.data as DomainPayloadMap[K] | null | undefined) ?? null,
    failure: failureOfState(state) ?? (thrown?.scope === scope ? thrown.failure : null),
  };
}
