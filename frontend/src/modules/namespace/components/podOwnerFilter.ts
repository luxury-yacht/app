import type { GridTableFilterState } from '@shared/components/tables/GridTable';
import {
  areGridTableFilterStatesEqual,
  normalizeGridTableFilterState,
} from '@shared/components/tables/gridTableFilterState';
import type { ClusterObjectReference } from '@shared/utils/objectIdentity';

const POD_OWNER_QUERY_FACET_KEY = 'owners';

export type PodWorkloadFilterRequest =
  | { type: 'set'; workload: ClusterObjectReference }
  | { type: 'clear' };

export const buildPodOwnerFacetValue = (workload: ClusterObjectReference): string => {
  const namespace = workload.namespace?.trim();
  if (!namespace) {
    throw new Error(`Cannot filter Pods for ${workload.kind}/${workload.name} without a namespace`);
  }
  return JSON.stringify([
    workload.kind === 'Pod' ? 'pod' : 'owner',
    workload.kind,
    workload.name,
    workload.clusterId,
    workload.group,
    workload.version,
    namespace,
  ]);
};

export const applyPodWorkloadFilterRequest = (
  current: GridTableFilterState,
  request: PodWorkloadFilterRequest,
  showNamespaceFilter: boolean
): GridTableFilterState => {
  const normalized = normalizeGridTableFilterState(current);
  const queryFacets = { ...(normalized.queryFacets ?? {}) };
  let namespaces = normalized.namespaces;

  if (request.type === 'set') {
    queryFacets[POD_OWNER_QUERY_FACET_KEY] = {
      mode: 'some',
      values: [buildPodOwnerFacetValue(request.workload)],
    };
    if (showNamespaceFilter) {
      namespaces = { mode: 'some', values: [request.workload.namespace ?? ''] };
    }
  } else {
    delete queryFacets[POD_OWNER_QUERY_FACET_KEY];
  }

  const next = normalizeGridTableFilterState({
    ...normalized,
    namespaces,
    queryFacets,
  });
  return areGridTableFilterStatesEqual(normalized, next) ? current : next;
};

export const podFiltersMatchWorkload = (
  filters: GridTableFilterState,
  workload: ClusterObjectReference,
  showNamespaceFilter: boolean
): boolean => {
  const normalized = normalizeGridTableFilterState(filters);
  const owners = normalized.queryFacets?.[POD_OWNER_QUERY_FACET_KEY];
  if (
    owners?.mode !== 'some' ||
    owners.values.length !== 1 ||
    owners.values[0] !== buildPodOwnerFacetValue(workload)
  ) {
    return false;
  }
  if (!showNamespaceFilter) {
    return true;
  }
  return (
    normalized.namespaces.mode === 'some' &&
    normalized.namespaces.values.length === 1 &&
    normalized.namespaces.values[0] === workload.namespace
  );
};
