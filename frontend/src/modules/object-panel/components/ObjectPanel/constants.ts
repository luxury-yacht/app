/**
 * frontend/src/modules/object-panel/components/ObjectPanel/constants.ts
 */

export const CLUSTER_SCOPE = '__cluster__';
export const INACTIVE_SCOPE = '__inactive__';

// Which tabs an object gets is decided in useObjectPanelTabs from its kind facets
// (shared/kinds/kindFacets), its identity, and its capabilities.
export const TABS = {
  DETAILS: { id: 'details', label: 'Details' },
  VALUES: { id: 'values', label: 'Values' },
  MANIFEST: { id: 'manifest', label: 'Manifest' },
  LOGS: { id: 'logs', label: 'Logs' },
  PODS: { id: 'pods', label: 'Pods' },
  JOBS: { id: 'jobs', label: 'Jobs' },
  EVENTS: { id: 'events', label: 'Events' },
  // Live metrics-server samples, kept while the panel is open (docs/architecture/resource-metrics.md).
  METRICS: { id: 'metrics', label: 'Metrics' },
  YAML: { id: 'yaml', label: 'YAML' },
  MAP: { id: 'map', label: 'Map' },
  SHELL: { id: 'shell', label: 'Shell' },
} as const;
