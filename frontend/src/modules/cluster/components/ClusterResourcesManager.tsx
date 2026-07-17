/**
 * frontend/src/modules/cluster/components/ClusterResourcesManager.tsx
 *
 * Manages the loading and error handling of various cluster resources and passes them to ClusterResourcesViews.
 * Handles permission checks and manual loading of resources.
 */

import ClusterResourcesViews from '@modules/cluster/components/ClusterResourcesViews';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import type { ClusterViewType } from '@ui/navigation/types';
import { useEffect } from 'react';
import type { PermissionStatus } from '@/core/capabilities';
import { useUserPermission } from '@/core/capabilities';
import { eventBus } from '@/core/events';
import { refreshOrchestrator } from '@/core/refresh';
import type { RefreshDomain } from '@/core/refresh/types';

// The managed cluster domains, reset together on kubeconfig switches so no
// stale per-cluster rows survive into the next selection. (Catalog is
// excluded — browse owns its own lifecycle.)
const CLUSTER_DOMAIN_SET = new Set<RefreshDomain>([
  'cluster-attention',
  'nodes',
  'cluster-rbac',
  'cluster-storage',
  'cluster-config',
  'cluster-crds',
  'cluster-events',
]);

interface ClusterResourceManagerProps {
  activeTab?: ClusterViewType | null;
  onTabChange?: (tab: ClusterViewType) => void;
}

// ClusterResourcesManager component
// Supplies the per-view permission-denial messages and resets the managed
// cluster domains when the kubeconfig changes. Each tab's table owns its own
// data via the query-backed grid.
export function ClusterResourcesManager({ activeTab, onTabChange }: ClusterResourceManagerProps) {
  useEffect(() => {
    const handleKubeconfigChanging = () => {
      CLUSTER_DOMAIN_SET.forEach((domain) => {
        // resetDomain already delegates to resetAllScopedDomainStates for scoped domains.
        refreshOrchestrator.resetDomain(domain);
      });
    };

    const unsubChanging = eventBus.on('kubeconfig:changing', handleKubeconfigChanging);
    return () => {
      unsubChanging();
    };
  }, []);

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
    />
  );
}
