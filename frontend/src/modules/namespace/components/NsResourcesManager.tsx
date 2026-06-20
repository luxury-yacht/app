/**
 * frontend/src/modules/namespace/components/NsResourcesManager.tsx
 *
 * Module source for NsResourcesManager.
 * Handles data fetching for namespace resources and passes it to the presentation component.
 * Follows the same pattern as ClusterResourcesManager.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import {
  useNamespaceResource,
  useNamespaceResources,
} from '@modules/namespace/contexts/NsResourcesContext';
import type { PodsResourceDataReturn } from '@modules/namespace/contexts/NsResourcesContext';
import NamespaceResourcesViews from '@modules/namespace/components/NsResourcesViews';
import { NamespaceViewType } from '@/types/navigation/views';

// The browse tab is catalog-driven, not a namespace resource loader.
const isLoadableNamespaceTab = (
  tab: NamespaceViewType
): tab is Exclude<NamespaceViewType, 'browse' | 'map' | 'custom'> =>
  tab !== 'browse' && tab !== 'map' && tab !== 'custom';

interface NamespaceResourcesManagerProps {
  namespace: string;
  activeTab?: NamespaceViewType;
  onTabChange?: (tab: NamespaceViewType) => void;
  objectPanel?: React.ReactNode;
  autoRefreshEnabled?: boolean;
  autoRefreshInterval?: number;
  resourceIntervals?: Record<string, number>;
}

/**
 * NamespaceResourcesManager that follows the same pattern as ClusterResourcesManager
 * Handles data fetching and passes it down to the presentation component
 */
export function NamespaceResourcesManager({
  namespace,
  activeTab,
  onTabChange,
  objectPanel,
}: NamespaceResourcesManagerProps) {
  const { setActiveResourceType } = useNamespaceResources();
  // Use the context-based hooks for each resource type
  // The namespace is provided by the NamespaceResourcesProvider
  const pods = useNamespaceResource('pods');
  const workloads = useNamespaceResource('workloads');
  const config = useNamespaceResource('config');
  const network = useNamespaceResource('network');
  const rbac = useNamespaceResource('rbac');
  const storage = useNamespaceResource('storage');
  const autoscaling = useNamespaceResource('autoscaling');
  const quotas = useNamespaceResource('quotas');
  const helm = useNamespaceResource('helm');
  const events = useNamespaceResource('events');

  const manualLoaders = useMemo(() => {
    const wrap = (load?: (showSpinner?: boolean) => Promise<void>) => {
      if (!load) {
        return async () => {};
      }
      return async () => {
        await load(true);
      };
    };

    return {
      pods: wrap(pods?.load),
      workloads: wrap(workloads?.load),
      config: wrap(config?.load),
      network: wrap(network?.load),
      rbac: wrap(rbac?.load),
      storage: wrap(storage?.load),
      autoscaling: wrap(autoscaling?.load),
      quotas: wrap(quotas?.load),
      custom: async () => {},
      helm: wrap(helm?.load),
      events: wrap(events?.load),
    };
  }, [
    pods?.load,
    autoscaling?.load,
    config?.load,
    events?.load,
    helm?.load,
    network?.load,
    quotas?.load,
    rbac?.load,
    storage?.load,
    workloads?.load,
  ]);

  const cancelAll = React.useCallback(() => {
    pods?.cancel?.();
    workloads?.cancel?.();
    config?.cancel?.();
    network?.cancel?.();
    rbac?.cancel?.();
    storage?.cancel?.();
    autoscaling?.cancel?.();
    quotas?.cancel?.();
    helm?.cancel?.();
    events?.cancel?.();
  }, [autoscaling, config, events, helm, network, pods, quotas, rbac, storage, workloads]);

  // Cancel all operations on unmount without retriggering mid-render
  const cancelAllRef = useRef(cancelAll);
  cancelAllRef.current = cancelAll;

  useEffect(() => {
    return () => {
      cancelAllRef.current();
    };
  }, []);

  useEffect(() => {
    if (activeTab) {
      setActiveResourceType(activeTab);
    }
  }, [activeTab, setActiveResourceType]);

  const resourceStates = useMemo(
    () => ({
      pods: {
        data: pods?.data,
        loading: pods?.loading ?? false,
        error: pods?.error ?? null,
        hasLoaded: pods?.hasLoaded ?? false,
      },
      workloads: {
        data: workloads?.data,
        loading: workloads?.loading ?? false,
        error: workloads?.error ?? null,
        hasLoaded: workloads?.hasLoaded ?? false,
      },
      config: {
        data: config?.data,
        loading: config?.loading ?? false,
        error: config?.error ?? null,
        hasLoaded: config?.hasLoaded ?? false,
      },
      network: {
        data: network?.data,
        loading: network?.loading ?? false,
        error: network?.error ?? null,
        hasLoaded: network?.hasLoaded ?? false,
      },
      rbac: {
        data: rbac?.data,
        loading: rbac?.loading ?? false,
        error: rbac?.error ?? null,
        hasLoaded: rbac?.hasLoaded ?? false,
      },
      storage: {
        data: storage?.data,
        loading: storage?.loading ?? false,
        error: storage?.error ?? null,
        hasLoaded: storage?.hasLoaded ?? false,
      },
      autoscaling: {
        data: autoscaling?.data,
        loading: autoscaling?.loading ?? false,
        error: autoscaling?.error ?? null,
        hasLoaded: autoscaling?.hasLoaded ?? false,
      },
      quotas: {
        data: quotas?.data,
        loading: quotas?.loading ?? false,
        error: quotas?.error ?? null,
        hasLoaded: quotas?.hasLoaded ?? false,
      },
      helm: {
        data: helm?.data,
        loading: helm?.loading ?? false,
        error: helm?.error ?? null,
        hasLoaded: helm?.hasLoaded ?? false,
      },
      events: {
        data: events?.data,
        loading: events?.loading ?? false,
        error: events?.error ?? null,
        hasLoaded: events?.hasLoaded ?? false,
      },
    }),
    [
      pods?.data,
      pods?.loading,
      pods?.error,
      pods?.hasLoaded,
      workloads?.data,
      workloads?.loading,
      workloads?.error,
      workloads?.hasLoaded,
      config?.data,
      config?.loading,
      config?.error,
      config?.hasLoaded,
      network?.data,
      network?.loading,
      network?.error,
      network?.hasLoaded,
      rbac?.data,
      rbac?.loading,
      rbac?.error,
      rbac?.hasLoaded,
      storage?.data,
      storage?.loading,
      storage?.error,
      storage?.hasLoaded,
      autoscaling?.data,
      autoscaling?.loading,
      autoscaling?.error,
      autoscaling?.hasLoaded,
      quotas?.data,
      quotas?.loading,
      quotas?.error,
      quotas?.hasLoaded,
      helm?.data,
      helm?.loading,
      helm?.error,
      helm?.hasLoaded,
      events?.data,
      events?.loading,
      events?.error,
      events?.hasLoaded,
    ]
  );

  useEffect(() => {
    const activeKey = activeTab ?? 'workloads';
    if (!isLoadableNamespaceTab(activeKey)) {
      // The objects view uses the catalog snapshot and handles its own refresh.
      return;
    }
    const state = resourceStates[activeKey];
    const triggerLoad = manualLoaders[activeKey];

    if (!namespace || !state || !triggerLoad) {
      return;
    }

    if (state.hasLoaded) {
      return;
    }

    if (state.loading || state.error) {
      return;
    }

    void triggerLoad();
  }, [namespace, activeTab, manualLoaders, resourceStates]);

  const podsMetrics = pods && 'metrics' in pods ? (pods as PodsResourceDataReturn).metrics : null;

  return (
    <NamespaceResourcesViews
      namespace={namespace}
      activeTab={activeTab || 'workloads'}
      onTabChange={onTabChange}
      // Pods metrics (pod rows are query-backed)
      nsPodsMetrics={podsMetrics}
      // Workloads data
      // Config data
      // Network data
      // RBAC data
      // Storage data
      // Autoscaling data
      // Quotas data
      // Custom resources data
      // Helm data
      // Events data
      objectPanel={objectPanel}
    />
  );
}
