/**
 * frontend/src/ui/navigation/types.ts
 *
 * Type definitions for types.
 * Defines shared interfaces and payload shapes for the UI layer.
 */

/**
 * Tab types for namespace-scoped resources
 */
export type NamespaceViewType =
  | 'objects'
  | 'workloads'
  | 'pods'
  | 'config'
  | 'network'
  | 'rbac'
  | 'storage'
  | 'autoscaling'
  | 'quotas'
  | 'custom'
  | 'helm'
  | 'events';

/**
 * Tab types for cluster-scoped resources
 */
export type ClusterViewType =
  | 'nodes'
  | 'rbac'
  | 'storage'
  | 'config'
  | 'crds'
  | 'custom'
  | 'events';
