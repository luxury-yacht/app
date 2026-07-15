/**
 * frontend/src/core/data-access/useScopedRefreshDomainLifecycle.ts
 *
 * Keeps a scoped refresh domain enabled while a component is mounted and
 * releases it on teardown without forcing callers to import the orchestrator.
 *
 * Enablement is reference-counted via scoped leases: a remounting or concurrent
 * consumer of the same (domain, scope) keeps the scope alive, so an old
 * instance's cleanup cannot disable a scope a newer instance still needs. That
 * remount race was the source of transient false-empty query-backed tables.
 */

import { useEffect, useRef } from 'react';

import type { RefreshDomain } from '@/core/refresh/types';
import {
  acquireRefreshDomainLease,
  releaseRefreshDomainLease,
  requestRefreshDomain,
} from './dataAccess';
import type { DataRequestReason } from './types';

interface ScopedRefreshDomainLifecycleOptions {
  domain: RefreshDomain | null | undefined;
  scope: string | null | undefined;
  enabled: boolean;
  preserveState?: boolean;
  fetchOnEnable?: DataRequestReason | false;
  fetchLabel?: string;
  onFetchError?: (error: unknown) => void;
}

// Owns the shared scoped-domain lifecycle: hold a lease for the current scope
// while mounted and enabled, and preserve cached data when the caller opts in.
export function useScopedRefreshDomainLifecycle({
  domain,
  scope,
  enabled,
  preserveState = false,
  fetchOnEnable = false,
  fetchLabel,
  onFetchError,
}: ScopedRefreshDomainLifecycleOptions): void {
  const onFetchErrorRef = useRef(onFetchError);
  const fetchLabelRef = useRef(fetchLabel);

  useEffect(() => {
    onFetchErrorRef.current = onFetchError;
    fetchLabelRef.current = fetchLabel;
  }, [fetchLabel, onFetchError]);

  useEffect(() => {
    if (!domain || !scope || !enabled) {
      return undefined;
    }

    // React runs the cleanup (release) before re-running on scope/enabled
    // changes and on unmount, so acquire/release stay balanced per consumer.
    // The runtime enables on the first lease and disables only after the last
    // lease is released.
    acquireRefreshDomainLease({ domain, scope, preserveState });

    if (fetchOnEnable) {
      void requestRefreshDomain({
        domain,
        scope,
        reason: fetchOnEnable,
        label: fetchLabelRef.current,
      }).catch((error) => {
        const handler = onFetchErrorRef.current;
        if (handler) {
          handler(error);
          return;
        }
        console.error(`Failed to fetch refresh domain ${domain} for scope ${scope}`, error);
      });
    }

    return () => {
      releaseRefreshDomainLease({ domain, scope, preserveState });
    };
  }, [domain, enabled, fetchOnEnable, preserveState, scope]);
}
