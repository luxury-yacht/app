/**
 * frontend/src/modules/cluster/components/ClusterResourcesManager.tsx
 *
 * Manages the loading and error handling of various cluster resources and passes them to ClusterResourcesViews.
 * Handles permission checks and manual loading of resources.
 */

import ClusterResourcesViews from '@modules/cluster/components/ClusterResourcesViews';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import type { ClusterViewType } from '@ui/navigation/types';
import type { PermissionStatus } from '@/core/capabilities';
import { useUserPermission } from '@/core/capabilities';
import { deniedFailure, type RefreshFailure } from '@/core/refresh/refreshFailure';

export interface ClusterResourceManagerProps {
  activeTab?: ClusterViewType | null;
}

// ClusterResourcesManager component
// Supplies the per-view permission-denial messages. Each tab's table owns its
// own data via the query-backed grid; the refresh orchestrator clears every
// domain when the kubeconfig selection empties.
export function ClusterResourcesManager({ activeTab }: Readonly<ClusterResourceManagerProps>) {
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
  // A read the permission gate refused: the view shows its empty state as
  // a permission denial.
  const permissionToMessage = (permission?: PermissionStatus): RefreshFailure | null => {
    if (!permission || permission.pending || permission.allowed) {
      return null;
    }
    if (permission.entry?.status !== 'ready') {
      return null;
    }
    return deniedFailure(permission.reason || 'Insufficient permissions');
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
