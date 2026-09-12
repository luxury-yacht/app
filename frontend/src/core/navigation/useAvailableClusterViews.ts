import { useRefreshDomainHandle } from '@core/data-access';
import { buildClusterScope } from '@core/refresh/clusterScope';
import { useStreamSignalRefetch } from '@core/refresh/hooks/useStreamSignalRefetch';
import { CLUSTER_VIEW_DESCRIPTORS } from './viewRegistry';

// Subscribe before any optional view is opened: availability describes discovered
// APIs, including installations whose resource tables are empty or denied.
export function useAvailableClusterViews(clusterId: string | null | undefined) {
  const scope = buildClusterScope(clusterId ?? undefined, 'limit=1');
  const enabled = Boolean(clusterId);
  const { data } = useRefreshDomainHandle({
    domain: 'catalog',
    scope,
    enabled,
    preserveState: true,
  });
  useStreamSignalRefetch('catalog', enabled ? [scope] : []);
  const families = enabled && data?.clusterId === clusterId ? data?.resourceFamilies : undefined;
  return CLUSTER_VIEW_DESCRIPTORS.filter(
    (view) => view.id !== 'karpenter' || families?.includes('karpenter')
  );
}
