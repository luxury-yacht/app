import {
  buildClusterRefreshScope,
  buildRefreshScope,
  CLUSTER_SELECTOR,
} from '@core/refresh/scopeSelector';
import { useLiveQueryRead, useLiveScope } from '@modules/resource-grid/useLiveQueryRead';
import { CLUSTER_VIEW_DESCRIPTORS, NAMESPACE_VIEW_DESCRIPTORS } from './viewRegistry';

// Subscribe before any optional view is opened: availability describes discovered
// APIs, including installations whose resource tables are empty or denied. The
// cluster's catalog stream signals changes; discovery itself is a one-shot read.
function useDiscoveredResourceFamilies(clusterId: string | null | undefined) {
  const live = useLiveScope({
    domain: 'catalog',
    scope: clusterId ? buildClusterRefreshScope('catalog', clusterId) : '',
    enabled: Boolean(clusterId),
  });
  const { payload } = useLiveQueryRead({
    domain: 'catalog',
    scope: clusterId
      ? buildRefreshScope('catalog', { clusterId, selector: CLUSTER_SELECTOR, query: 'limit=1' })
      : '',
    enabled: live.ready,
    liveDataVersion: live.liveDataVersion,
    label: 'Resource discovery',
    // Passive: discovery pauses with auto-refresh, as the catalog stream does.
    reason: 'startup',
  });
  return clusterId && payload?.clusterId === clusterId ? payload?.resourceFamilies : undefined;
}

export function useAvailableClusterViews(clusterId: string | null | undefined) {
  const families = useDiscoveredResourceFamilies(clusterId);
  return CLUSTER_VIEW_DESCRIPTORS.filter(
    (view) => !('resourceFamily' in view) || families?.cluster?.includes(view.resourceFamily)
  );
}

export function useAvailableNamespaceViews(clusterId: string | null | undefined) {
  const families = useDiscoveredResourceFamilies(clusterId);
  return NAMESPACE_VIEW_DESCRIPTORS.filter(
    (view) => !('resourceFamily' in view) || families?.namespaced?.includes(view.resourceFamily)
  );
}
