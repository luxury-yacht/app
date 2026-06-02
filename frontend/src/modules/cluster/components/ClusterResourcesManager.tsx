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
import type { SnapshotStats } from '@/core/refresh/client';

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
  const { nodes, rbac, storage, config, crds, events, setActiveResourceType } =
    useClusterResources();

  const { data: nodesData, loading: nodesLoading, error: nodesError } = nodes;
  const { data: configData, loading: configLoading, error: configError } = config;
  const { data: crdsData, loading: crdsLoading, error: crdsError } = crds;
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
  const configGatewayClassPermission = useUserPermission(
    'GatewayClass',
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

  // Only surface a permission message when the backend definitively denied
  // access (status === 'ready').  Errors (e.g. "cluster not active" during
  // initial activation) are transient and should not be shown as denials.
  const permissionToMessage = (permission?: PermissionStatus): string | null => {
    if (!permission || permission.pending || permission.allowed) {
      return null;
    }
    if (permission.entry?.status !== 'ready') {
      return null;
    }
    return permission.reason || 'Insufficient permissions';
  };

  const configPermissionMessage =
    permissionToMessage(configStorageClassPermission) ||
    permissionToMessage(configIngressClassPermission) ||
    permissionToMessage(configGatewayClassPermission) ||
    permissionToMessage(configValidatingWebhookPermission) ||
    permissionToMessage(configMutatingWebhookPermission);

  const nodesErrorMessage = nodesError?.message || permissionToMessage(nodesListPermission) || null;
  const configErrorMessage = configError?.message || configPermissionMessage || null;
  const crdsErrorMessage = crdsError?.message || permissionToMessage(crdListPermission) || null;
  const customErrorMessage = permissionToMessage(crdListPermission) || null;
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
      nodesStats={(nodes?.meta as { tableStats?: SnapshotStats } | undefined)?.tableStats}
      nodesLoading={nodesLoading || false}
      nodesError={nodesErrorMessage}
      nodesLoaded={(nodes?.hasLoaded ?? false) || Boolean(nodesErrorMessage)}
      // Config
      config={configData || []}
      configStats={(config?.meta as { tableStats?: SnapshotStats } | undefined)?.tableStats}
      configKinds={(config?.meta as { kinds?: string[] } | undefined)?.kinds}
      configLoading={configLoading || false}
      configError={configErrorMessage}
      configLoaded={(config?.hasLoaded ?? false) || Boolean(configErrorMessage)}
      // CRDs
      crds={crdsData || []}
      crdsStats={(crds?.meta as { tableStats?: SnapshotStats } | undefined)?.tableStats}
      crdsLoading={crdsLoading || false}
      crdsError={crdsErrorMessage}
      crdsLoaded={(crds?.hasLoaded ?? false) || Boolean(crdsErrorMessage)}
      // Custom
      customLoading={false}
      customError={customErrorMessage}
      customLoaded={Boolean(customErrorMessage)}
      // Events
      events={eventsData || []}
      eventsStats={(events?.meta as { tableStats?: SnapshotStats } | undefined)?.tableStats}
      eventsLoading={eventsLoading || false}
      eventsError={eventsErrorMessage}
      eventsLoaded={(events?.hasLoaded ?? false) || Boolean(eventsErrorMessage)}
      // RBAC
      rbac={rbacData || []}
      rbacStats={(rbac?.meta as { tableStats?: SnapshotStats } | undefined)?.tableStats}
      rbacKinds={(rbac?.meta as { kinds?: string[] } | undefined)?.kinds}
      rbacLoading={rbacLoading || false}
      rbacError={rbacErrorMessage}
      rbacLoaded={(rbac?.hasLoaded ?? false) || Boolean(rbacErrorMessage)}
      // Storage
      storage={storageData || []}
      storageStats={(storage?.meta as { tableStats?: SnapshotStats } | undefined)?.tableStats}
      storageLoading={storageLoading || false}
      storageError={storageErrorMessage}
      storageLoaded={(storage?.hasLoaded ?? false) || Boolean(storageErrorMessage)}
      // Object panel
      objectPanel={objectPanel}
    />
  );
}
