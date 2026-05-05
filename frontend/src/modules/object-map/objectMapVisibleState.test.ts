/**
 * frontend/src/modules/object-map/objectMapVisibleState.test.ts
 *
 * Tests visible object-map state derivation for filters, focus, search, and legend.
 */

import { describe, expect, it } from 'vitest';
import type { ObjectMapEdge, ObjectMapNode, ObjectMapReference } from '@core/refresh/types';
import { computeObjectMapLayout } from './objectMapLayout';
import {
  deriveObjectMapVisibleState,
  pruneObjectMapEnabledEdgeTypes,
  pruneObjectMapSelectedKinds,
} from './objectMapVisibleState';

const ref = (
  id: string,
  kind: string,
  name: string,
  group = '',
  version = 'v1'
): ObjectMapReference => ({
  clusterId: 'cluster-a',
  group,
  version,
  kind,
  namespace: 'default',
  name,
  uid: `${id}-uid`,
});

const node = (id: string, kind: string, name: string, depth: number): ObjectMapNode => ({
  id,
  depth,
  ref: ref(id, kind, name),
});

const edge = (
  id: string,
  source: string,
  target: string,
  type: string,
  label = type
): ObjectMapEdge => ({
  id,
  source,
  target,
  type,
  label,
});

const derive = ({
  nodes,
  edges,
  seedId = nodes[0]?.id ?? '',
  activeNodeId = null,
  focusMode = false,
  selectedKinds = [],
  enabledEdgeTypes = null,
  searchQuery = '',
}: {
  nodes: ObjectMapNode[];
  edges: ObjectMapEdge[];
  seedId?: string;
  activeNodeId?: string | null;
  focusMode?: boolean;
  selectedKinds?: string[];
  enabledEdgeTypes?: Set<string> | null;
  searchQuery?: string;
}) =>
  deriveObjectMapVisibleState({
    layout: computeObjectMapLayout(nodes, edges, seedId),
    seedNodeId: seedId,
    activeNodeId,
    focusMode,
    selectedKinds,
    enabledEdgeTypes,
    searchQuery,
    useShortResourceNames: false,
  });

describe('deriveObjectMapVisibleState', () => {
  it('applies relationship filters before rendering', () => {
    const result = derive({
      nodes: [node('deploy', 'Deployment', 'web', 0), node('pod', 'Pod', 'web-a', 1)],
      edges: [edge('owner-1', 'deploy', 'pod', 'owner', 'owns')],
      enabledEdgeTypes: new Set(),
    });

    expect(result.visibleLayout.nodes.map((n) => n.id)).toEqual(['deploy', 'pod']);
    expect(result.visibleLayout.edges).toHaveLength(0);
    expect(result.legendEntries.some((entry) => entry.type === 'owner')).toBe(true);
  });

  it('preserves directed transitive relationships through kinds hidden by the kind filter', () => {
    const result = derive({
      nodes: [
        node('service', 'Service', 'frontend', 0),
        node('slice', 'EndpointSlice', 'frontend-a', 1),
        node('pod', 'Pod', 'frontend-a', 2),
      ],
      edges: [
        edge('service-slice', 'service', 'slice', 'endpoint', 'has endpoints'),
        edge('slice-pod', 'slice', 'pod', 'routes', 'routes to'),
      ],
      selectedKinds: ['Service', 'Pod'],
    });

    expect(result.visibleLayout.nodes.map((n) => n.id).sort()).toEqual(['pod', 'service']);
    expect(result.visibleLayout.edges).toHaveLength(1);
    expect(result.visibleLayout.edges[0]).toMatchObject({
      sourceId: 'service',
      targetId: 'pod',
      type: 'filtered-path',
    });
    expect(result.visibleLayout.edges[0].filteredPath?.nodes.map((n) => n.id)).toEqual([
      'service',
      'slice',
      'pod',
    ]);
  });

  it('keeps kind-filtered layout anchored to the map seed instead of selection', () => {
    const nodes = [
      node('service', 'Service', 'frontend', 0),
      node('slice', 'EndpointSlice', 'frontend-a', 1),
      node('pod-a', 'Pod', 'frontend-a', 2),
      node('pod-b', 'Pod', 'frontend-b', 2),
    ];
    const edges = [
      edge('service-slice', 'service', 'slice', 'endpoint'),
      edge('slice-pod-a', 'slice', 'pod-a', 'routes'),
      edge('slice-pod-b', 'slice', 'pod-b', 'routes'),
    ];
    const unselected = derive({
      nodes,
      edges,
      seedId: 'service',
      selectedKinds: ['Service', 'Pod'],
    });
    const selected = derive({
      nodes,
      edges,
      seedId: 'service',
      activeNodeId: 'pod-b',
      selectedKinds: ['Service', 'Pod'],
    });

    expect(selected.visibleLayout.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
      unselected.visibleLayout.nodes.map((node) => [node.id, node.x, node.y])
    );
    expect(selected.visibleSelectionState.activeId).toBe('pod-b');
  });

  it('focuses recursively related visible objects', () => {
    const result = derive({
      nodes: [
        node('deploy', 'Deployment', 'web', 0),
        node('pod-a', 'Pod', 'web-a', 1),
        node('pod-b', 'Pod', 'web-b', 1),
        node('config', 'ConfigMap', 'web-config', 2),
        node('secret', 'Secret', 'web-secret', 3),
      ],
      edges: [
        edge('deploy-pod-a', 'deploy', 'pod-a', 'owner'),
        edge('deploy-pod-b', 'deploy', 'pod-b', 'owner'),
        edge('pod-config', 'pod-a', 'config', 'uses'),
        edge('config-secret', 'config', 'secret', 'uses'),
      ],
      activeNodeId: 'pod-a',
      focusMode: true,
    });

    expect(result.visibleLayout.nodes.map((n) => n.id).sort()).toEqual([
      'config',
      'deploy',
      'pod-a',
      'secret',
    ]);
    expect(result.visibleLayout.edges.map((e) => e.id).sort()).toEqual([
      'config-secret',
      'deploy-pod-a',
      'pod-config',
    ]);
  });

  it('keeps the active object at the same map coordinate in focus mode', () => {
    const nodes = [
      node('deploy', 'Deployment', 'web', 0),
      node('pod-a', 'Pod', 'web-a', 1),
      node('pod-b', 'Pod', 'web-b', 1),
      node('config', 'ConfigMap', 'web-config', 2),
      node('secret', 'Secret', 'web-secret', 3),
    ];
    const edges = [
      edge('deploy-pod-a', 'deploy', 'pod-a', 'owner'),
      edge('deploy-pod-b', 'deploy', 'pod-b', 'owner'),
      edge('pod-config', 'pod-a', 'config', 'uses'),
      edge('config-secret', 'config', 'secret', 'uses'),
    ];
    const unselected = derive({ nodes, edges });
    const focused = derive({
      nodes,
      edges,
      activeNodeId: 'pod-a',
      focusMode: true,
    });
    const unselectedActiveNode = unselected.visibleLayout.nodes.find((n) => n.id === 'pod-a');
    const focusedActiveNode = focused.visibleLayout.nodes.find((n) => n.id === 'pod-a');

    expect(focusedActiveNode).toBeTruthy();
    expect(focusedActiveNode?.x).toBe(unselectedActiveNode?.x);
    expect(focusedActiveNode?.y).toBe(unselectedActiveNode?.y);
  });

  it('searches only visible nodes', () => {
    const result = derive({
      nodes: [
        node('service', 'Service', 'frontend', 0),
        node('slice', 'EndpointSlice', 'frontend-a', 1),
        node('pod', 'Pod', 'frontend-a', 2),
      ],
      edges: [
        edge('service-slice', 'service', 'slice', 'endpoint'),
        edge('slice-pod', 'slice', 'pod', 'routes'),
      ],
      selectedKinds: ['Service', 'Pod'],
      searchQuery: 'endpoint',
    });

    expect(result.searchMatches).toHaveLength(0);
  });
});

describe('object map visible state pruning', () => {
  it('prunes edge and kind selections against available options', () => {
    expect(
      Array.from(pruneObjectMapEnabledEdgeTypes(new Set(['owner', 'stale']), new Set(['owner']))!)
    ).toEqual(['owner']);
    expect(
      pruneObjectMapSelectedKinds(
        ['Deployment', 'Stale'],
        [
          { value: 'Deployment', label: 'Deployment' },
          { value: 'Pod', label: 'Pod' },
        ]
      )
    ).toEqual(['Deployment']);
  });
});
