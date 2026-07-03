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
  const { setActiveResourceType } = useClusterResources();

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

  // Each view is query-backed and surfaces its own fetch errors; the manager
  // contributes only the permission-derived denial messages.
  const nodesErrorMessage = permissionToMessage(nodesListPermission) || null;
  const configErrorMessage = configPermissionMessage || null;
  const crdsErrorMessage = permissionToMessage(crdListPermission) || null;
  const customErrorMessage = permissionToMessage(crdListPermission) || null;
  const eventsErrorMessage = permissionToMessage(eventsListPermission) || null;
  const rbacErrorMessage = permissionToMessage(rbacListPermission) || null;
  const storageErrorMessage = permissionToMessage(storageListPermission) || null;

  // Keep ClusterResourcesContext informed about the active view for refresh scheduling
  useEffect(() => {
    if (!activeTab) {
      return;
    }

    setActiveResourceType(activeTab);
  }, [activeTab, setActiveResourceType]);

  return (
    <ClusterResourcesViews
      activeTab={activeTab}
      onTabChange={onTabChange}
      // Each view is query-backed and sources its own rows and fetch errors;
      // the manager supplies only the permission-derived denial message per
      // view. Custom is catalog-backed and takes loading/loaded.
      nodesError={nodesErrorMessage}
      configError={configErrorMessage}
      crdsError={crdsErrorMessage}
      customLoading={false}
      customError={customErrorMessage}
      customLoaded={Boolean(customErrorMessage)}
      eventsError={eventsErrorMessage}
      rbacError={rbacErrorMessage}
      storageError={storageErrorMessage}
      objectPanel={objectPanel}
    />
  );
}
