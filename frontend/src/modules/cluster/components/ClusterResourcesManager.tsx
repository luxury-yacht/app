/**
 * frontend/src/modules/cluster/components/ClusterResourcesManager.tsx
 *
 * Manages the loading and error handling of various cluster resources and passes them to ClusterResourcesViews.
 * Handles permission checks and manual loading of resources.
 */

import React, { useEffect } from 'react';
import { useClusterResources } from '@modules/cluster/contexts/ClusterResourcesContext';
import ClusterResourcesViews from '@modules/cluster/components/ClusterResourcesViews';
import { ClusterViewType } from '@ui/navigation/types';
import { useUserPermission } from '@/core/capabilities';
import type { PermissionStatus } from '@/core/capabilities';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

interface ClusterResourceManagerProps {
  activeTab?: ClusterViewType | null;
  onTabChange?: (tab: ClusterViewType) => void;
  refreshSettings?: any;
  objectPanel?: React.ReactNode;
  autoRefreshEnabled?: boolean;
  autoRefreshInterval?: number;
  resourceIntervals?: Record<string, number>;
}

// ClusterResourcesManager component
// Handles data fetching, error handling, and permission checks for cluster resources
export function ClusterResourcesManager({
  activeTab,
  onTabChange,
  objectPanel,
}: ClusterResourceManagerProps) {
  const { nodes, rbac, storage, config, crds, custom, events, setActiveResourceType } =
    useClusterResources();

  const { data: nodesData, loading: nodesLoading, error: nodesError } = nodes;
  const { data: configData, loading: configLoading, error: configError } = config;
  const { data: crdsData, loading: crdsLoading, error: crdsError } = crds;
  const { data: customData, loading: customLoading, error: customError } = custom;
  const { data: eventsData, loading: eventsLoading, error: eventsError } = events;
  const { data: rbacData, loading: rbacLoading, error: rbacError } = rbac;
  const { data: storageData, loading: storageLoading, error: storageError } = storage;

  const { selectedClusterId } = useKubeconfig();
  // Scope permission lookups to the active cluster to avoid cache collisions.
  const permissionClusterId = selectedClusterId || null;

  const nodesListPermission = useUserPermission('Node', 'list', null, null, permissionClusterId);
  const configStorageClassPermission = useUserPermission(
    'StorageClass',
    'list',
    null,
    null,
    permissionClusterId
  );
  const configIngressClassPermission = useUserPermission(
    'IngressClass',
    'list',
    null,
    null,
    permissionClusterId
  );
  const crdListPermission = useUserPermission(
    'CustomResourceDefinition',
    'list',
    null,
    null,
    permissionClusterId
  );
  const eventsListPermission = useUserPermission('Event', 'list', null, null, permissionClusterId);
  const rbacListPermission = useUserPermission(
    'ClusterRole',
    'list',
    null,
    null,
    permissionClusterId
  );
  const storageListPermission = useUserPermission(
    'PersistentVolume',
    'list',
    null,
    null,
    permissionClusterId
  );
  const configValidatingWebhookPermission = useUserPermission(
    'ValidatingWebhookConfiguration',
    'list',
    null,
    null,
    permissionClusterId
  );
  const configMutatingWebhookPermission = useUserPermission(
    'MutatingWebhookConfiguration',
    'list',
    null,
    null,
    permissionClusterId
  );

  const permissionToMessage = (permission?: PermissionStatus): string | null => {
    if (!permission || permission.pending || permission.allowed) {
      return null;
    }
    return permission.reason || 'Insufficient permissions';
  };

  const configPermissionMessage =
    permissionToMessage(configStorageClassPermission) ||
    permissionToMessage(configIngressClassPermission) ||
    permissionToMessage(configValidatingWebhookPermission) ||
    permissionToMessage(configMutatingWebhookPermission);

  const nodesErrorMessage = nodesError?.message || permissionToMessage(nodesListPermission) || null;
  const configErrorMessage = configError?.message || configPermissionMessage || null;
  const crdsErrorMessage = crdsError?.message || permissionToMessage(crdListPermission) || null;
  const customErrorMessage = customError?.message || permissionToMessage(crdListPermission) || null;
  const eventsErrorMessage =
    eventsError?.message || permissionToMessage(eventsListPermission) || null;
  const rbacErrorMessage = rbacError?.message || permissionToMessage(rbacListPermission) || null;
  const storageErrorMessage =
    storageError?.message || permissionToMessage(storageListPermission) || null;

  // Keep ClusterResourcesContext informed about the active view for refresh scheduling
  useEffect(() => {
    if (!activeTab) {
      return;
    }

    setActiveResourceType(activeTab);
  }, [activeTab, setActiveResourceType]);

  return (
    <ClusterResourcesViews
      // Tabs
      activeTab={activeTab}
      onTabChange={onTabChange}
      // Nodes
      nodes={nodesData || []}
      nodesLoading={nodesLoading || false}
      nodesError={nodesErrorMessage}
      nodesLoaded={(nodes?.hasLoaded ?? false) || Boolean(nodesErrorMessage)}
      // Config
      config={configData || []}
      configLoading={configLoading || false}
      configError={configErrorMessage}
      configLoaded={(config?.hasLoaded ?? false) || Boolean(configErrorMessage)}
      // CRDs
      crds={crdsData || []}
      crdsLoading={crdsLoading || false}
      crdsError={crdsErrorMessage}
      crdsLoaded={(crds?.hasLoaded ?? false) || Boolean(crdsErrorMessage)}
      // Custom
      custom={customData || []}
      customLoading={customLoading || false}
      customError={customErrorMessage}
      customLoaded={(custom?.hasLoaded ?? false) || Boolean(customErrorMessage)}
      // Events
      events={eventsData || []}
      eventsLoading={eventsLoading || false}
      eventsError={eventsErrorMessage}
      eventsLoaded={(events?.hasLoaded ?? false) || Boolean(eventsErrorMessage)}
      // RBAC
      rbac={rbacData || []}
      rbacLoading={rbacLoading || false}
      rbacError={rbacErrorMessage}
      rbacLoaded={(rbac?.hasLoaded ?? false) || Boolean(rbacErrorMessage)}
      // Storage
      storage={storageData || []}
      storageLoading={storageLoading || false}
      storageError={storageErrorMessage}
      storageLoaded={(storage?.hasLoaded ?? false) || Boolean(storageErrorMessage)}
      // Object panel
      objectPanel={objectPanel}
    />
  );
}
