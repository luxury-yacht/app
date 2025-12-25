/**
 * frontend/src/types/navigation/views.ts
 *
 * Type definitions for views.
 * Defines shared interfaces and payload shapes for the frontend.
 */


export type ViewType = 'namespace' | 'cluster' | 'overview' | 'settings' | 'about';

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

export type ClusterViewType =
  | 'nodes'
  | 'rbac'
  | 'storage'
  | 'config'
  | 'crds'
  | 'custom'
  | 'events'
  | 'browse';
