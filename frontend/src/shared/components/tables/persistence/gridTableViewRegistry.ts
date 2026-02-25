/**
 * frontend/src/shared/components/tables/persistence/gridTableViewRegistry.ts
 *
 * UI component for gridTableViewRegistry.
 * Handles rendering and interactions for the shared components.
 */

const VIEW_IDS = new Set<string>([
  'browse',
  'cluster-nodes',
  'cluster-rbac',
  'cluster-storage',
  'cluster-config',
  'cluster-crds',
  'cluster-events',
  'cluster-custom',
  'namespace-workloads',
  'namespace-pods',
  'namespace-events',
  'namespace-network',
  'namespace-storage',
  'namespace-autoscaling',
  'namespace-quotas',
  'namespace-config',
  'namespace-custom',
  'namespace-rbac',
  'namespace-helm',
  'namespace-browse',
  'object-panel-pods',
  'object-panel-jobs',
]);

export const isRegisteredGridTableView = (viewId: string): boolean => VIEW_IDS.has(viewId);

export const registerGridTableView = (viewId: string): void => {
  const normalized = viewId?.trim();
  if (!normalized) {
    return;
  }
  VIEW_IDS.add(normalized);
};

export const listRegisteredGridTableViews = (): string[] => Array.from(VIEW_IDS);

export const resetGridTableViewRegistryForTests = (viewIds?: string[]): void => {
  VIEW_IDS.clear();
  (viewIds ?? []).forEach((id) => VIEW_IDS.add(id));
};
