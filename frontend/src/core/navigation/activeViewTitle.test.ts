import { describe, expect, it } from 'vitest';
import { ALL_NAMESPACES_SCOPE } from '@/modules/namespace/constants';
import { buildActiveViewTitleParts, formatActiveViewHeaderTitle } from './activeViewTitle';

describe('buildActiveViewTitleParts', () => {
  it.each([
    {
      name: 'names the cluster, namespace, and view of a namespace view',
      input: { viewType: 'namespace', activeViewTab: 'workloads', namespace: 'payments' },
      expected: ['prod', 'payments', 'Workloads'],
    },
    {
      name: 'shows All Namespaces instead of the scope sentinel',
      input: { viewType: 'namespace', activeViewTab: 'events', namespace: ALL_NAMESPACES_SCOPE },
      expected: ['prod', 'All Namespaces', 'Events'],
    },
    {
      name: 'omits the selected namespace from cluster views',
      input: { viewType: 'cluster', activeViewTab: 'nodes', namespace: 'payments' },
      expected: ['prod', 'Nodes'],
    },
    {
      name: 'labels the cluster landing route',
      input: { viewType: 'overview', activeViewTab: null, namespace: 'payments' },
      expected: ['prod', 'Overview'],
    },
    {
      name: 'omits the cluster from views that span clusters',
      input: { viewType: 'global', activeViewTab: 'fleet', namespace: 'payments' },
      expected: ['Clusters'],
    },
  ] as const)('$name', ({ input, expected }) => {
    expect(buildActiveViewTitleParts({ ...input, clusterName: 'prod' })).toEqual(expected);
  });
});

describe('formatActiveViewHeaderTitle', () => {
  it.each([
    {
      name: 'shows the namespace and view without the cluster',
      input: { viewType: 'namespace', activeViewTab: 'workloads', namespace: 'payments' },
      expected: 'payments - Workloads',
    },
    {
      name: 'names the cluster scope for cluster views',
      input: { viewType: 'cluster', activeViewTab: 'nodes', namespace: 'payments' },
      expected: 'Cluster - Nodes',
    },
    {
      name: 'names the cluster scope for the cluster landing route',
      input: { viewType: 'overview', activeViewTab: null, namespace: undefined },
      expected: 'Cluster - Overview',
    },
    {
      name: 'keeps views that span clusters unscoped',
      input: { viewType: 'global', activeViewTab: 'fleet', namespace: undefined },
      expected: 'Clusters',
    },
  ] as const)('$name', ({ input, expected }) => {
    expect(formatActiveViewHeaderTitle(input)).toBe(expected);
  });
});
