/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelScopedDomainLifecycle.ts
 *
 * Object-panel scoped refresh-domain lifecycle helpers. These centralize the
 * preserveState teardown used when panel content or individual tabs unmount
 * without fully evicting the panel scope, while keeping full scope resets
 * explicit at the actual panel-close or resource-deleted boundaries.
 */

import { useEffect, useRef } from 'react';

import {
  requestRefreshDomain,
  resetRefreshDomain,
  setRefreshDomainEnabled,
  type DataRequestReason,
} from '@/core/data-access';
import type { RefreshDomain } from '@/core/refresh/types';

export type ObjectPanelLifecycleDomain = Extract<
  RefreshDomain,
  | 'container-logs'
  | 'object-details'
  | 'object-events'
  | 'object-helm-manifest'
  | 'object-helm-values'
  | 'object-map'
  | 'object-yaml'
>;

export interface ObjectPanelScopedDomainRef {
  domain: ObjectPanelLifecycleDomain;
  scope: string | null | undefined;
}

interface ActiveScopedDomain {
  domain: ObjectPanelLifecycleDomain;
  scope: string;
}

interface ObjectPanelScopedDomainLifecycleOptions extends ObjectPanelScopedDomainRef {
  enabled: boolean;
  fetchOnEnable?: DataRequestReason | false;
  onFetchError?: (error: unknown) => void;
  preserveStateOnEnable?: boolean;
  preserveStateOnDisable?: boolean;
}

const scopedDomainKey = ({ domain, scope }: ActiveScopedDomain): string => `${domain}\0${scope}`;

const activeScopedDomain = ({
  domain,
  scope,
}: ObjectPanelScopedDomainRef): ActiveScopedDomain | null => {
  if (!scope) {
    return null;
  }
  return { domain, scope };
};

const activeScopedDomainMap = (
  refs: readonly ObjectPanelScopedDomainRef[]
): Map<string, ActiveScopedDomain> => {
  const next = new Map<string, ActiveScopedDomain>();
  refs.forEach((ref) => {
    const active = activeScopedDomain(ref);
    if (active) {
      next.set(scopedDomainKey(active), active);
    }
  });
  return next;
};

const setObjectPanelScopedDomainEnabled = (
  { domain, scope }: ActiveScopedDomain,
  enabled: boolean,
  preserveState: boolean
): void => {
  setRefreshDomainEnabled({ domain, scope, enabled, preserveState });
};

const disableObjectPanelScopedDomain = ({ domain, scope }: ActiveScopedDomain): void => {
  setObjectPanelScopedDomainEnabled({ domain, scope }, false, true);
};

export const resetObjectPanelScopedDomain = (ref: ObjectPanelScopedDomainRef): void => {
  const active = activeScopedDomain(ref);
  if (!active) {
    return;
  }
  setObjectPanelScopedDomainEnabled(active, false, false);
  resetRefreshDomain(active.domain, active.scope);
};

export function useObjectPanelScopedDomainCleanups(
  refs: readonly ObjectPanelScopedDomainRef[],
  enabled: boolean
): void {
  const activeRef = useRef<Map<string, ActiveScopedDomain>>(new Map());

  useEffect(() => {
    if (!enabled) {
      activeRef.current.forEach(disableObjectPanelScopedDomain);
      activeRef.current = new Map();
      return;
    }

    const next = activeScopedDomainMap(refs);
    activeRef.current.forEach((scope, key) => {
      if (!next.has(key)) {
        disableObjectPanelScopedDomain(scope);
      }
    });
    activeRef.current = next;
  }, [enabled, refs]);

  useEffect(() => {
    return () => {
      activeRef.current.forEach(disableObjectPanelScopedDomain);
      activeRef.current = new Map();
    };
  }, []);
}

export function useObjectPanelScopedDomainLifecycle({
  domain,
  scope,
  enabled,
  fetchOnEnable = false,
  onFetchError,
  preserveStateOnEnable = false,
  preserveStateOnDisable = true,
}: ObjectPanelScopedDomainLifecycleOptions): void {
  useEffect(() => {
    const active = activeScopedDomain({ domain, scope });
    if (!active) {
      return;
    }

    setObjectPanelScopedDomainEnabled(active, enabled, preserveStateOnEnable);
    if (enabled && fetchOnEnable) {
      const request = requestRefreshDomain({
        domain: active.domain,
        scope: active.scope,
        reason: fetchOnEnable,
      });
      if (onFetchError) {
        void request.catch(onFetchError);
      } else {
        void request;
      }
    }

    return () => {
      setObjectPanelScopedDomainEnabled(active, false, preserveStateOnDisable);
    };
  }, [
    domain,
    enabled,
    fetchOnEnable,
    onFetchError,
    preserveStateOnDisable,
    preserveStateOnEnable,
    scope,
  ]);
}
