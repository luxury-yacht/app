/**
 * Human-readable location of the active workspace view: cluster, namespace (for
 * namespace views), and view label. Shared by the app header title and the
 * default names of new favorites.
 *
 * Keep this module React-free, like the view registry it reads.
 */

import { ALL_NAMESPACES_DISPLAY_NAME, isAllNamespaces } from '@/modules/namespace/constants';
import type { ViewType } from '@/types/navigation/views';
import { getViewDescriptor, type ViewScope } from './viewRegistry';

export const getActiveViewTab = (
  viewType: ViewType,
  activeGlobalTab: string | null,
  activeNamespaceTab: string | null,
  activeClusterTab: string | null
): string | null => {
  if (viewType === 'global') {
    return activeGlobalTab;
  }
  if (viewType === 'namespace') {
    return activeNamespaceTab;
  }
  return activeClusterTab;
};

const toViewScope = (viewType: ViewType): ViewScope =>
  viewType === 'global' || viewType === 'namespace' ? viewType : 'cluster';

export const getActiveViewLabel = (viewType: ViewType, activeViewTab: string | null): string => {
  // The cluster landing route has no registry descriptor; the sidebar calls it Overview.
  if (viewType === 'overview') {
    return 'Overview';
  }
  if (!activeViewTab) {
    return '';
  }
  return getViewDescriptor(toViewScope(viewType), activeViewTab)?.label ?? activeViewTab;
};

interface ActiveViewLocation {
  viewType: ViewType;
  activeViewTab: string | null;
  clusterName?: string;
  namespace?: string;
}

export const buildActiveViewTitleParts = ({
  viewType,
  activeViewTab,
  clusterName,
  namespace,
}: ActiveViewLocation): string[] => {
  const parts: string[] = [];
  // Global views span every open cluster, so no single cluster names them.
  if (viewType !== 'global' && clusterName) {
    parts.push(clusterName);
  }
  if (viewType === 'namespace' && namespace) {
    parts.push(isAllNamespaces(namespace) ? ALL_NAMESPACES_DISPLAY_NAME : namespace);
  }
  const viewLabel = getActiveViewLabel(viewType, activeViewTab);
  if (viewLabel) {
    parts.push(viewLabel);
  }
  return parts;
};

// The app header already sits above the cluster tabs, so it names the scope
// instead of the cluster: the namespace on namespace views, "Cluster" on
// cluster-scoped routes.
export const formatActiveViewHeaderTitle = (
  location: Omit<ActiveViewLocation, 'clusterName'>
): string => {
  const parts = buildActiveViewTitleParts(location);
  const isClusterScoped = location.viewType === 'cluster' || location.viewType === 'overview';
  return (isClusterScoped ? ['Cluster', ...parts] : parts).join(' - ');
};
