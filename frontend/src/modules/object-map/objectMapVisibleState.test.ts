/**
 * frontend/src/modules/object-map/objectMapVisibleState.test.ts
 *
 * Tests visible object-map state derivation for filters, pins, search, and legend.
 */

import type { ObjectMapEdge, ObjectMapNode, ObjectMapReference } from '@core/refresh/types';
import {
  ALL_MULTISELECT_FILTER,
  type MultiSelectFilterSelection,
  NONE_MULTISELECT_FILTER,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import { describe, expect, it } from 'vitest';
import { compareUtf16Strings } from '@/shared/utils/sort';
import { requireValue } from '@/test-utils/requireValue';
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
  selectedKinds = ALL_MULTISELECT_FILTER,
  enabledEdgeTypes = null,
  searchQuery = '',
  pinnedPositions = new Map(),
}: {
  nodes: ObjectMapNode[];
  edges: ObjectMapEdge[];
  seedId?: string;
  activeNodeId?: string | null;
  selectedKinds?: MultiSelectFilterSelection;
  enabledEdgeTypes?: Set<string> | null;
  searchQuery?: string;
  pinnedPositions?: ReadonlyMap<string, { x: number; y: number }>;
}) =>
  deriveObjectMapVisibleState({
    layout: computeObjectMapLayout(nodes, edges, seedId),
    seedNodeId: seedId,
    activeNodeId,
    selectedKinds,
    enabledEdgeTypes,
    searchQuery,
    useShortResourceNames: false,
    pinnedPositions,
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
      selectedKinds: { mode: 'some', values: ['Service', 'Pod'] },
    });

    expect(result.visibleLayout.nodes.map((n) => n.id).sort(compareUtf16Strings)).toEqual([
      'pod',
      'service',
    ]);
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
      selectedKinds: { mode: 'some', values: ['Service', 'Pod'] },
    });
    const selected = derive({
      nodes,
      edges,
      seedId: 'service',
      activeNodeId: 'pod-b',
      selectedKinds: { mode: 'some', values: ['Service', 'Pod'] },
    });

    expect(
      selected.visibleLayout.nodes.map((selectedNode) => [
        selectedNode.id,
        selectedNode.x,
        selectedNode.y,
      ])
    ).toEqual(
      unselected.visibleLayout.nodes.map((unselectedNode) => [
        unselectedNode.id,
        unselectedNode.x,
        unselectedNode.y,
      ])
    );
    expect(selected.visibleSelectionState.activeId).toBe('pod-b');
  });

  it('keeps pinned objects where the user dropped them in every view', () => {
    const nodes = [
      node('deploy', 'Deployment', 'web', 0),
      node('rs', 'ReplicaSet', 'web-rs', 1),
      node('pod', 'Pod', 'web-pod', 2),
    ];
    const edges = [
      edge('deploy-rs', 'deploy', 'rs', 'owner'),
      edge('rs-pod', 'rs', 'pod', 'owner'),
    ];
    const base = computeObjectMapLayout(nodes, edges, 'deploy');
    const at = (layout: typeof base, id: string) =>
      requireValue(
        layout.nodes.find((n) => n.id === id),
        `node ${id}`
      );
    const pin = { x: at(base, 'pod').x + 500, y: at(base, 'pod').y + 300 };
    const pinnedPositions = new Map([['pod', pin]]);
    const views = {
      unfiltered: {},
      kindFilter: {
        selectedKinds: {
          mode: 'some',
          values: ['Deployment', 'ReplicaSet', 'Pod'],
        } as MultiSelectFilterSelection,
      },
    };

    for (const [view, options] of Object.entries(views)) {
      const visible = derive({ nodes, edges, pinnedPositions, ...options }).visibleLayout;
      expect({ view, x: at(visible, 'pod').x, y: at(visible, 'pod').y }).toEqual({ view, ...pin });
      const podEdge = requireValue(
        visible.edges.find((e) => e.id === 'rs-pod'),
        'rs-pod edge'
      );
      expect(podEdge.d.endsWith(`${pin.x} ${pin.y + at(visible, 'pod').height / 2}`), view).toBe(
        true
      );
    }
  });

  it('keeps a missing object marked missing when the kind filter re-lays out the map', () => {
    const result = derive({
      nodes: [
        node('deploy', 'Deployment', 'web', 0),
        { ...node('cm', 'ConfigMap', 'web-settings', 0), missing: true },
        node('svc', 'Service', 'web', 0),
      ],
      edges: [],
      seedId: '',
      selectedKinds: { mode: 'some', values: ['Deployment', 'ConfigMap'] },
    });

    const visible = result.visibleLayout.nodes;
    expect(visible.map((n) => n.id).sort(compareUtf16Strings)).toEqual(['cm', 'deploy']);
    expect(visible.find((n) => n.id === 'cm')?.missing).toBe(true);
    expect(visible.find((n) => n.id === 'deploy')?.missing).toBeFalsy();
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
      selectedKinds: { mode: 'some', values: ['Service', 'Pod'] },
      searchQuery: 'endpoint',
    });

    expect(result.searchMatches).toHaveLength(0);
  });

  it('shows no objects when every kind is explicitly deselected', () => {
    const result = derive({
      nodes: [node('deploy', 'Deployment', 'web', 0), node('pod', 'Pod', 'web-a', 1)],
      edges: [edge('owner-1', 'deploy', 'pod', 'owner', 'owns')],
      selectedKinds: NONE_MULTISELECT_FILTER,
    });

    expect(result.visibleLayout.nodes).toEqual([]);
    expect(result.visibleLayout.edges).toEqual([]);
  });
});

describe('object map visible state pruning', () => {
  it('prunes edge and kind selections against available options', () => {
    expect(
      Array.from(
        requireValue(
          pruneObjectMapEnabledEdgeTypes(new Set(['owner', 'stale']), new Set(['owner'])),
          'expected test value in objectMapVisibleState.test.ts'
        )
      )
    ).toEqual(['owner']);
    expect(
      pruneObjectMapSelectedKinds({ mode: 'some', values: ['Deployment', 'Stale'] }, [
        { value: 'Deployment', label: 'Deployment' },
        { value: 'Pod', label: 'Pod' },
      ])
    ).toEqual({ mode: 'some', values: ['Deployment'] });
  });
});
