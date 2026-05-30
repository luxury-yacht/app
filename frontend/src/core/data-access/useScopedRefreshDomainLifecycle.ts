/**
 * frontend/src/core/data-access/useScopedRefreshDomainLifecycle.ts
 *
 * Keeps a scoped refresh domain enabled while a component is mounted and
 * disables it on teardown without forcing callers to import the orchestrator.
 */

import { useEffect, useRef } from 'react';

import type { RefreshDomain } from '@/core/refresh/types';
import { setRefreshDomainEnabled } from './dataAccess';

const PRESERVE_SCOPED_STATE = { preserveState: true } as const;

interface ScopedRefreshDomainLifecycleOptions {
  domain: RefreshDomain | null | undefined;
  scope: string | null | undefined;
  enabled: boolean;
  preserveState?: boolean;
}

interface ActiveScope {
  domain: RefreshDomain;
  scope: string;
}

const sameScope = (a: ActiveScope | null, b: ActiveScope | null): boolean =>
  Boolean(a && b && a.domain === b.domain && a.scope === b.scope);

const setScopeEnabled = (scope: ActiveScope, enabled: boolean, preserveState: boolean) => {
  setRefreshDomainEnabled({
    domain: scope.domain,
    scope: scope.scope,
    enabled,
    ...(preserveState ? PRESERVE_SCOPED_STATE : {}),
  });
};

// Owns the shared scoped-domain lifecycle: enable the current scope, disable
// replaced scopes, and preserve cached data when the caller opts in.
export function useScopedRefreshDomainLifecycle({
  domain,
  scope,
  enabled,
  preserveState = false,
}: ScopedRefreshDomainLifecycleOptions): void {
  const activeRef = useRef<ActiveScope | null>(null);

  useEffect(() => {
    const next = domain && scope ? { domain, scope } : null;
    const previous = activeRef.current;

    if (previous && !sameScope(previous, next)) {
      setScopeEnabled(previous, false, preserveState);
    }

    activeRef.current = next;

    if (!next) {
      return undefined;
    }

    setScopeEnabled(next, enabled, preserveState);

    return () => {
      setScopeEnabled(next, false, preserveState);
      if (sameScope(activeRef.current, next)) {
        activeRef.current = null;
      }
    };
  }, [domain, enabled, preserveState, scope]);
}
