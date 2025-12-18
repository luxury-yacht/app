/**
 * App-level type definitions
 * Navigation and view-related types used throughout the application
 */

/**
 * Tab types for namespace-scoped resources
 */
export type NamespaceViewType =
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
