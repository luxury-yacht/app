import { describe, expect, it } from 'vitest';
import {
  parseClusterViewType,
  parseGlobalViewType,
  parseNamespaceViewType,
} from '@/types/navigation/views';
import {
  CLUSTER_VIEW_DESCRIPTORS,
  getViewDescriptor,
  NAMESPACE_VIEW_DESCRIPTORS,
} from './viewRegistry';

describe('view registry', () => {
  it('migrates the removed Pods route to the combined Workloads view', () => {
    expect(parseNamespaceViewType('pods')).toBe('workloads');
    expect(getViewDescriptor('namespace', 'pods')).toBeUndefined();
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
    expect(getViewDescriptor('global', 'fleet')?.id).toBe('fleet');
    expect(getViewDescriptor('global', 'global-namespaces')?.id).toBe('global-namespaces');
    expect(getViewDescriptor('cluster', 'browse')?.id).toBe('browse');
    expect(getViewDescriptor('cluster', 'attention')?.id).toBe('attention');
    expect(getViewDescriptor('namespace', 'map')?.id).toBe('map');
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
