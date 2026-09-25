import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { isLiveDomainInitialLoadPending } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { useTypedResourceQuery } from '@modules/resource-grid/useTypedResourceQuery';
import { ALL_MULTISELECT_FILTER } from '@shared/components/dropdowns/multiSelectFilterSelection';
import { useMemo } from 'react';
import { useRefreshDomainHandle } from '@/core/data-access';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useQueryStreamSignal } from '@/core/refresh/hooks/useStreamSignalRefetch';
import type { ClusterIdentitiesSnapshot, ClusterIdentity } from '@/core/refresh/types';
import type { IdentityPanelRef } from '../panelTarget';

export function useIdentityDetails(ref: IdentityPanelRef, enabled: boolean) {
  const { state } = useRefreshDomainHandle({
    domain: 'cluster-identities',
    scope: buildClusterScope(ref.clusterId, ''),
    enabled,
    preserveState: true,
    demand: 'query',
    fetchOnEnable: false,
  });
  const liveDataVersion = useQueryStreamSignal('cluster-identities', state);
  const filters = useMemo(
    () => ({
      search: '',
      caseSensitive: true,
      includeMetadata: false,
      kinds: { mode: 'some' as const, values: [ref.kind] },
      namespaces: ALL_MULTISELECT_FILTER,
      clusters: ALL_MULTISELECT_FILTER,
    }),
    [ref.kind]
  );
  const predicates = useMemo(
    () => ({ identity: JSON.stringify([ref.clusterId, ref.kind, '', ref.name]) }),
    [ref.clusterId, ref.kind, ref.name]
  );
  return useTypedResourceQuery<ClusterIdentitiesSnapshot, ClusterIdentity>({
    enabled: enabled && !isLiveDomainInitialLoadPending(state),
    clusterId: ref.clusterId,
    domain: 'cluster-identities',
    label: 'Identity details',
    baseScope: '',
    filters,
    sortConfig: null,
    pageLimit: 1,
    predicates,
    liveDataVersion,
    selectRows: selectPayloadRows,
  });
}
