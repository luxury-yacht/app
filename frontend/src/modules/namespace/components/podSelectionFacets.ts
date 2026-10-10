import type { GridTableFilterState } from '@shared/components/tables/GridTable';
import type { ClusterObjectReference } from '@shared/utils/objectIdentity';

const POD_OWNER_QUERY_FACET_KEY = 'owners';
const POD_NODE_QUERY_FACET_KEY = 'nodes';

/** Facets an attached pods table reserves for its parent row; the user never holds them. */
export const POD_SELECTION_QUERY_FACET_KEYS = [
  POD_OWNER_QUERY_FACET_KEY,
  POD_NODE_QUERY_FACET_KEY,
] as const;

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

const isNodeReference = (object: ClusterObjectReference): boolean =>
  object.kind === 'Node' && object.group === '';

/**
 * The pods column that only repeats the parent row a pods table is attached
 * to: every pod under a node runs on it, every pod under a workload has it as
 * owner.
 */
export const podParentColumnKey = (parent: ClusterObjectReference): 'node' | 'owner' =>
  isNodeReference(parent) ? 'node' : 'owner';

/**
 * The query facets that narrow an attached pods table to its parent row: a
 * node's pods by node name, otherwise the pods a workload (or a standalone
 * Pod) owns. A parent from another cluster narrows nothing.
 */
export const podSelectionQueryFacets = (
  selected: ClusterObjectReference | null | undefined,
  clusterId: string | null | undefined
): GridTableFilterState['queryFacets'] => {
  if (!selected || !clusterId || selected.clusterId !== clusterId) {
    return undefined;
  }
  if (isNodeReference(selected)) {
    return { [POD_NODE_QUERY_FACET_KEY]: { mode: 'some', values: [selected.name] } };
  }
  return {
    [POD_OWNER_QUERY_FACET_KEY]: { mode: 'some', values: [buildPodOwnerFacetValue(selected)] },
  };
};
