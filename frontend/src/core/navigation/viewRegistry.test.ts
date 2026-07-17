import { describe, expect, it } from 'vitest';
import {
  parseClusterViewType,
  parseGlobalViewType,
  parseNamespaceViewType,
} from '@/types/navigation/views';
import {
  CLUSTER_VIEW_DESCRIPTORS,
  GLOBAL_VIEW_DESCRIPTORS,
  getViewDescriptor,
  NAMESPACE_VIEW_DESCRIPTORS,
} from './viewRegistry';

describe('view registry', () => {
  it('defines the canonical ordered global navigation vocabulary', () => {
    expect(
      GLOBAL_VIEW_DESCRIPTORS.map(({ id, label, scope }) => ({
        id,
        label,
        scope,
      }))
    ).toEqual([
      { id: 'fleet', label: 'Clusters', scope: 'global' },
      { id: 'global-namespaces', label: 'Namespaces', scope: 'global' },
    ]);
    expect(GLOBAL_VIEW_DESCRIPTORS.some((descriptor) => 'intent' in descriptor)).toBe(false);
    expect(GLOBAL_VIEW_DESCRIPTORS[0].description).toBe(
      'Compare health, capacity, and metrics across open clusters'
    );
    expect(GLOBAL_VIEW_DESCRIPTORS[0].keywords).not.toContain('access');
  });

  it('defines the canonical ordered cluster navigation vocabulary', () => {
    expect(CLUSTER_VIEW_DESCRIPTORS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'attention', label: 'Attention' },
      { id: 'namespaces', label: 'Namespaces' },
      { id: 'browse', label: 'Browse' },
      { id: 'events', label: 'Events' },
      { id: 'nodes', label: 'Nodes' },
      { id: 'config', label: 'Config' },
      { id: 'storage', label: 'Storage' },
      { id: 'crds', label: 'CRDs' },
      { id: 'custom', label: 'Custom' },
      { id: 'rbac', label: 'RBAC' },
    ]);
    expect(CLUSTER_VIEW_DESCRIPTORS.some((descriptor) => 'intent' in descriptor)).toBe(false);
  });

  it('defines the canonical ordered namespace navigation vocabulary', () => {
    expect(NAMESPACE_VIEW_DESCRIPTORS.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'browse', label: 'Browse' },
      { id: 'map', label: 'Map' },
      { id: 'events', label: 'Events' },
      { id: 'workloads', label: 'Workloads' },
      { id: 'autoscaling', label: 'Autoscaling' },
      { id: 'helm', label: 'Helm' },
      { id: 'config', label: 'Config' },
      { id: 'network', label: 'Network' },
      { id: 'storage', label: 'Storage' },
      { id: 'custom', label: 'Custom' },
      { id: 'quotas', label: 'Quotas' },
      { id: 'rbac', label: 'RBAC' },
    ]);
    expect(NAMESPACE_VIEW_DESCRIPTORS.some((descriptor) => 'intent' in descriptor)).toBe(false);
  });

  it('migrates the removed Pods route to the combined Workloads view', () => {
    expect(parseNamespaceViewType('pods')).toBe('workloads');
    expect(getViewDescriptor('namespace', 'pods')).toBeUndefined();
  });

  it('carries presentation, search, and refresh metadata for every view', () => {
    const descriptors = [
      ...GLOBAL_VIEW_DESCRIPTORS,
      ...CLUSTER_VIEW_DESCRIPTORS,
      ...NAMESPACE_VIEW_DESCRIPTORS,
    ];

    for (const descriptor of descriptors) {
      expect(descriptor.description.length).toBeGreaterThan(0);
      expect(descriptor.keywords).toContain(descriptor.id);
      expect(descriptor.refresher === null || descriptor.refresher.length > 0).toBe(true);
    }
  });

  it('maps target lens language onto the existing stable navigation surfaces', () => {
    expect(getViewDescriptor('cluster', 'browse')?.keywords).toContain('inventory');
    expect(getViewDescriptor('namespace', 'browse')?.keywords).toContain('inventory');
    expect(getViewDescriptor('cluster', 'nodes')?.keywords).toContain('capacity');
    expect(getViewDescriptor('cluster', 'events')?.keywords).toContain('change');
    expect(getViewDescriptor('namespace', 'events')?.keywords).toContain('change');

    expect(CLUSTER_VIEW_DESCRIPTORS.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining(['inventory', 'capacity', 'change'])
    );
    expect(NAMESPACE_VIEW_DESCRIPTORS.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining(['inventory', 'capacity', 'change'])
    );
  });

  it('looks up views by both scope and id', () => {
    expect(getViewDescriptor('global', 'fleet')?.label).toBe('Clusters');
    expect(getViewDescriptor('global', 'global-namespaces')?.label).toBe('Namespaces');
    expect(getViewDescriptor('cluster', 'browse')?.label).toBe('Browse');
    expect(getViewDescriptor('cluster', 'attention')?.label).toBe('Attention');
    expect(getViewDescriptor('namespace', 'map')?.label).toBe('Map');
    expect(getViewDescriptor('cluster', 'map')).toBeUndefined();
  });

  it('keeps global and cluster route ids in disjoint runtime vocabularies', () => {
    expect(parseGlobalViewType('fleet')).toBe('fleet');
    expect(parseGlobalViewType('global-namespaces')).toBe('global-namespaces');
    expect(parseGlobalViewType('nodes')).toBeUndefined();
    expect(parseClusterViewType('nodes')).toBe('nodes');
    expect(parseClusterViewType('fleet')).toBeUndefined();
    expect(parseClusterViewType('global-namespaces')).toBeUndefined();
  });

  it('declares which namespace views support the all-namespaces scope', () => {
    expect(
      NAMESPACE_VIEW_DESCRIPTORS.filter((view) => !view.supportsAllNamespaces).map(
        (view) => view.id
      )
    ).toEqual(['map']);
  });
});
