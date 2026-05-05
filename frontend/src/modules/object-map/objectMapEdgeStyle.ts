/**
 * frontend/src/modules/object-map/objectMapEdgeStyle.ts
 *
 * Frontend relationship registry for backend object-map edge `type`
 * values plus frontend-only presentation edges such as filtered-path.
 * Keep backend relationship entries in sync with the relationship
 * registry in backend/refresh/snapshot/object_map.go.
 */

export interface EdgeKindMeta {
  /** Backend edge type token. */
  type: string;
  /** Human-readable label shown in the legend. */
  label: string;
  /** Broad relationship family, used to keep legend ordering stable. */
  family: 'structural' | 'network' | 'workload' | 'rbac' | 'dependency' | 'storage' | 'filter';
}

export const OBJECT_MAP_EDGE_FAMILY_LABELS: Record<EdgeKindMeta['family'], string> = {
  structural: 'Structure',
  network: 'Network',
  workload: 'Workload',
  rbac: 'RBAC',
  dependency: 'Dependency',
  storage: 'Storage',
  filter: 'Filter',
};

// Order chosen so structural relationships (ownership, traffic flow)
// appear before dependency relationships, roughly mirroring how a user
// reads a map left-to-right.
export const OBJECT_MAP_EDGE_KINDS: readonly EdgeKindMeta[] = [
  { type: 'owner', label: 'Ownership', family: 'structural' },
  { type: 'selector', label: 'Selector', family: 'network' },
  { type: 'endpoint', label: 'Endpoint', family: 'network' },
  { type: 'routes', label: 'Ingress Route', family: 'network' },
  { type: 'scales', label: 'Scaling', family: 'workload' },
  { type: 'schedules', label: 'Scheduled On', family: 'workload' },
  { type: 'grants', label: 'Grants', family: 'rbac' },
  { type: 'binds', label: 'Binds', family: 'rbac' },
  { type: 'aggregates', label: 'Aggregates', family: 'rbac' },
  { type: 'uses', label: 'Used By', family: 'dependency' },
  { type: 'mounts', label: 'Mounts', family: 'storage' },
  { type: 'volume-binding', label: 'Volume Binding', family: 'storage' },
  { type: 'storage-class', label: 'Storage Class', family: 'storage' },
  { type: 'filtered-path', label: 'Filtered path', family: 'filter' },
];

const KNOWN_EDGE_TYPES = new Set(OBJECT_MAP_EDGE_KINDS.map((entry) => entry.type));

export const objectMapEdgeClass = (edgeType: string): string => {
  const normalized = edgeType.trim().toLowerCase();
  const variant = KNOWN_EDGE_TYPES.has(normalized) ? normalized : 'default';
  return `object-map-edge object-map-edge--${variant}`;
};
