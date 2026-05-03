/**
 * frontend/src/modules/object-map/objectMapEdgeStyle.ts
 *
 * Maps backend edge `type` values to a CSS class so each edge picks up
 * the right stroke colour from ObjectMap.css. Keep this list in sync
 * with the tracer categories in backend/refresh/snapshot/object_map.go.
 */

interface EdgeKindMeta {
  /** Backend edge type token. */
  type: string;
  /** Human-readable label shown in the legend. */
  label: string;
}

// Order chosen so structural relationships (ownership, traffic flow)
// appear before dependency relationships, roughly mirroring how a user
// reads a map left-to-right.
export const OBJECT_MAP_EDGE_KINDS: readonly EdgeKindMeta[] = [
  { type: 'owner', label: 'Owner' },
  { type: 'selector', label: 'Selector' },
  { type: 'endpoint', label: 'Endpoint' },
  { type: 'routes', label: 'Routes' },
  { type: 'scales', label: 'Scales' },
  { type: 'schedules', label: 'Scheduled on' },
  { type: 'uses', label: 'Uses' },
  { type: 'mounts', label: 'Mounts' },
  { type: 'storage', label: 'Storage' },
];

const KNOWN_EDGE_TYPES = new Set(OBJECT_MAP_EDGE_KINDS.map((entry) => entry.type));

export const objectMapEdgeClass = (edgeType: string): string => {
  const normalized = edgeType.trim().toLowerCase();
  const variant = KNOWN_EDGE_TYPES.has(normalized) ? normalized : 'default';
  return `object-map-edge object-map-edge--${variant}`;
};
