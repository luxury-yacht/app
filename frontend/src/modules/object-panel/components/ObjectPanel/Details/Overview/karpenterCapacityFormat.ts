/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/karpenterCapacityFormat.ts
 *
 * Quantity formatting and resource ordering shared by the Karpenter capacity blocks
 * (NodePool/NodeOverlay summary rows and the NodeClaim allocatable/capacity grid).
 */

import {
  formatCpuValue,
  formatResourceValue,
  parseResourceValue,
} from '@shared/utils/resourceCalculations';

export type CpuUnit = 'cores' | 'millicores';

export const formatCapacityValue = (
  resource: string,
  value: string | undefined,
  cpuUnit: CpuUnit
): string => {
  if (value === undefined || value === '') {
    return '-';
  }
  if (resource === 'cpu') {
    const millicores = parseResourceValue(value, 'cpu');
    const formatted = formatResourceValue(value, millicores, 'cpu');
    return cpuUnit === 'cores' && formatted !== '-' ? formatCpuValue(millicores) : formatted;
  }
  return resource === 'memory' || resource === 'ephemeral-storage'
    ? formatResourceValue(value, parseResourceValue(value, 'memory'), 'memory')
    : value;
};

/** Millicores when any listed CPU quantity is not a whole number of cores. */
export const detectCpuUnit = (values: readonly (string | undefined)[]): CpuUnit =>
  values.some((value) => parseResourceValue(value, 'cpu') % 1000 !== 0) ? 'millicores' : 'cores';

const capacityResourceOrder = [
  'cpu',
  'memory',
  'ephemeral-storage',
  'nodes',
  'pods',
  'vpc.amazonaws.com/pod-eni',
  'hugepages',
];

const capacityResourceLabels: Record<string, string> = {
  'ephemeral-storage': 'storage',
  'vpc.amazonaws.com/pod-eni': 'pod-eni',
};

export const capacityResourceLabel = (resource: string): string =>
  capacityResourceLabels[resource] ?? resource;

const capacityResourceRank = (resource: string): number => {
  const key = resource.startsWith('hugepages-') ? 'hugepages' : resource;
  const index = capacityResourceOrder.indexOf(key);
  return index < 0 ? capacityResourceOrder.length : index;
};

/** Distinct resource names across the given quantity maps, in display order. */
export const sortedCapacityResources = (
  maps: readonly (Record<string, string> | undefined)[]
): string[] =>
  [...new Set(maps.flatMap((map) => Object.keys(map ?? {})))].sort(
    (a, b) => capacityResourceRank(a) - capacityResourceRank(b) || a.localeCompare(b)
  );
