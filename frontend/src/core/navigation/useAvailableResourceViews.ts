import { useRefreshDomainHandle } from '@core/data-access';
import { buildClusterScope } from '@core/refresh/clusterScope';
import { useStreamSignalRefetch } from '@core/refresh/hooks/useStreamSignalRefetch';
import { CLUSTER_VIEW_DESCRIPTORS, NAMESPACE_VIEW_DESCRIPTORS } from './viewRegistry';

// Subscribe before any optional view is opened: availability describes discovered
// APIs, including installations whose resource tables are empty or denied.
function useDiscoveredResourceFamilies(clusterId: string | null | undefined) {
  const scope = buildClusterScope(clusterId ?? undefined, 'limit=1');
  const enabled = Boolean(clusterId);
  const { data } = useRefreshDomainHandle({
    domain: 'catalog',
    scope,
    enabled,
    preserveState: true,
  });
  useStreamSignalRefetch('catalog', enabled ? [scope] : []);
  return enabled && data?.clusterId === clusterId ? data?.resourceFamilies : undefined;
}

export function useAvailableClusterViews(clusterId: string | null | undefined) {
  const families = useDiscoveredResourceFamilies(clusterId);
  return CLUSTER_VIEW_DESCRIPTORS.filter(
    (view) => view.id !== 'karpenter' || families?.includes('karpenter')
  );
}

export function useAvailableNamespaceViews(clusterId: string | null | undefined) {
  const families = useDiscoveredResourceFamilies(clusterId);
  return NAMESPACE_VIEW_DESCRIPTORS.filter(
    (view) => view.id !== 'argocd' || families?.includes('argocd')
  );
}
