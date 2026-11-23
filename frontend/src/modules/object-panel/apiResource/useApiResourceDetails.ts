/**
 * frontend/src/modules/object-panel/apiResource/useApiResourceDetails.ts
 *
 * Reads the one API Resources row that describes a kind panel's kind, and
 * follows the domain's change signal so the details track rediscovery.
 */

import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { isLiveDomainInitialLoadPending } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import { useTypedResourceQuery } from '@modules/resource-grid/useTypedResourceQuery';
import { ALL_MULTISELECT_FILTER } from '@shared/components/dropdowns/multiSelectFilterSelection';
import { useMemo } from 'react';
import { useRefreshDomainHandle } from '@/core/data-access';
import { useQueryStreamSignal } from '@/core/refresh/hooks/useQueryStreamSignal';
import { buildRefreshScope, CLUSTER_SELECTOR } from '@/core/refresh/scopeSelector';
import type { ClusterAPIResourceEntry, ClusterAPIResourcesSnapshot } from '@/core/refresh/types';
import type { ApiResourcePanelRef } from '../panelTarget';

const ALL_ROWS = {
  search: '',
  includeMetadata: false,
  kinds: ALL_MULTISELECT_FILTER,
  namespaces: ALL_MULTISELECT_FILTER,
  clusters: ALL_MULTISELECT_FILTER,
};

export function useApiResourceDetails(ref: ApiResourcePanelRef, enabled: boolean) {
  const { state } = useRefreshDomainHandle({
    domain: 'cluster-api-resources',
    scope: buildRefreshScope('cluster-api-resources', {
      clusterId: ref.clusterId,
      selector: CLUSTER_SELECTOR,
    }),
    enabled,
    preserveState: true,
    demand: 'query',
    fetchOnEnable: false,
  });
  const liveDataVersion = useQueryStreamSignal('cluster-api-resources', state);
  // A resource's fully qualified name, `<plural>.<group>` (`<plural>` in the core group).
  const predicates = useMemo(
    () => ({ resource: ref.group ? `${ref.resource}.${ref.group}` : ref.resource }),
    [ref.group, ref.resource]
  );
  return useTypedResourceQuery<ClusterAPIResourcesSnapshot, ClusterAPIResourceEntry>({
    enabled: enabled && !isLiveDomainInitialLoadPending(state),
    clusterId: ref.clusterId,
    domain: 'cluster-api-resources',
    label: 'Kind details',
    baseSelector: CLUSTER_SELECTOR,
    filters: ALL_ROWS,
    sortConfig: null,
    pageLimit: 1,
    predicates,
    liveDataVersion,
    selectRows: selectPayloadRows,
  });
}
