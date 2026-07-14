import { describe, expect, it } from 'vitest';
import {
  CLUSTER_VIEW_DESCRIPTORS,
  getViewDescriptor,
  groupViewDescriptors,
  NAMESPACE_VIEW_DESCRIPTORS,
} from './viewRegistry';

describe('view registry', () => {
  it('defines the canonical ordered cluster navigation vocabulary', () => {
    expect(
      CLUSTER_VIEW_DESCRIPTORS.map(({ id, label, intent }) => ({ id, label, intent }))
    ).toEqual([
      { id: 'fleet', label: 'Fleet', intent: 'inventory' },
      { id: 'attention', label: 'Needs Attention', intent: 'operations' },
      { id: 'browse', label: 'Browse', intent: 'inventory' },
      { id: 'nodes', label: 'Nodes', intent: 'compute' },
      { id: 'config', label: 'Config', intent: 'configuration' },
      { id: 'crds', label: 'CRDs', intent: 'extensions' },
      { id: 'custom', label: 'Custom', intent: 'extensions' },
      { id: 'events', label: 'Events', intent: 'operations' },
      { id: 'rbac', label: 'RBAC', intent: 'security' },
      { id: 'storage', label: 'Storage', intent: 'storage' },
    ]);
  });

  it('defines the canonical ordered namespace navigation vocabulary', () => {
    expect(
      NAMESPACE_VIEW_DESCRIPTORS.map(({ id, label, intent }) => ({ id, label, intent }))
    ).toEqual([
      { id: 'browse', label: 'Browse', intent: 'inventory' },
      { id: 'map', label: 'Map', intent: 'topology' },
      { id: 'applications', label: 'Applications', intent: 'applications' },
      { id: 'workloads', label: 'Workloads', intent: 'compute' },
      { id: 'pods', label: 'Pods', intent: 'compute' },
      { id: 'autoscaling', label: 'Autoscaling', intent: 'compute' },
      { id: 'config', label: 'Config', intent: 'configuration' },
      { id: 'custom', label: 'Custom', intent: 'extensions' },
      { id: 'events', label: 'Events', intent: 'operations' },
      { id: 'helm', label: 'Helm', intent: 'applications' },
      { id: 'network', label: 'Network', intent: 'network' },
      { id: 'quotas', label: 'Quotas', intent: 'governance' },
      { id: 'rbac', label: 'RBAC', intent: 'security' },
      { id: 'storage', label: 'Storage', intent: 'storage' },
    ]);
  });

  it('carries presentation, search, and refresh metadata for every view', () => {
    const descriptors = [...CLUSTER_VIEW_DESCRIPTORS, ...NAMESPACE_VIEW_DESCRIPTORS];

    for (const descriptor of descriptors) {
      expect(descriptor.description.length).toBeGreaterThan(0);
      expect(descriptor.keywords).toContain(descriptor.id);
      expect(descriptor.refresher === null || descriptor.refresher.length > 0).toBe(true);
    }
  });

  it('looks up views by both scope and id', () => {
    expect(getViewDescriptor('cluster', 'browse')?.label).toBe('Browse');
    expect(getViewDescriptor('namespace', 'map')?.label).toBe('Map');
    expect(getViewDescriptor('cluster', 'map')).toBeUndefined();
  });

  it('declares which namespace views support the all-namespaces scope', () => {
    expect(
      NAMESPACE_VIEW_DESCRIPTORS.filter((view) => !view.supportsAllNamespaces).map(
        (view) => view.id
      )
    ).toEqual(['map']);
  });

  it('groups views by user intent while preserving view order within each group', () => {
    expect(
      groupViewDescriptors(CLUSTER_VIEW_DESCRIPTORS).map(({ id, label, views }) => ({
        id,
        label,
        views: views.map((view) => view.id),
      }))
    ).toEqual([
      { id: 'observe', label: 'Observe', views: ['fleet', 'attention', 'browse', 'events'] },
      { id: 'run', label: 'Run', views: ['nodes'] },
      { id: 'configure', label: 'Configure', views: ['config', 'storage'] },
      { id: 'govern', label: 'Govern', views: ['crds', 'custom', 'rbac'] },
    ]);

    expect(
      groupViewDescriptors(NAMESPACE_VIEW_DESCRIPTORS).map(({ id, views }) => ({
        id,
        views: views.map((view) => view.id),
      }))
    ).toEqual([
      { id: 'observe', views: ['browse', 'map', 'events'] },
      { id: 'run', views: ['applications', 'workloads', 'pods', 'autoscaling', 'helm'] },
      { id: 'configure', views: ['config', 'network', 'storage'] },
      { id: 'govern', views: ['custom', 'quotas', 'rbac'] },
    ]);
  });
});
