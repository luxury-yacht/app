/**
 * frontend/src/modules/object-map/objectMapPerformance.test.ts
 *
 * Performance tests for large object-map layout and G6 data conversion paths.
 */

import { describe, expect, it } from 'vitest';
import { computeCollapseInfo, filterByCollapseInfo } from './objectMapCollapse';
import { dedupeServiceEdges } from './objectMapDedupe';
import { filterByDirectionalReachability } from './objectMapDirectionalFilter';
import { toObjectMapG6Data } from './objectMapG6Data';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import { computeObjectMapLayout, routeObjectMapEdges } from './objectMapLayout';
import { createObjectMapPerformanceFixture } from './objectMapPerformanceFixtures';
import { computeObjectMapSelectionState } from './objectMapSelection';
import type { ObjectMapSelectionState } from './objectMapRendererTypes';

const EMPTY_SELECTION: ObjectMapSelectionState = {
  activeId: null,
  connectedIds: new Set(),
  connectedEdgeIds: new Set(),
};

const PALETTE: ObjectMapG6Palette = {
  accent: '#2563eb',
  accentBg: '#dbeafe',
  background: '#ffffff',
  backgroundSecondary: '#f8fafc',
  border: '#cbd5e1',
  text: '#0f172a',
  textSecondary: '#64748b',
  textTertiary: '#9ca3af',
  textInverse: '#ffffff',
  statusHealthy: '#22c55e',
  statusRefreshing: '#16a34a',
  statusDegraded: '#f59e0b',
  statusUnhealthy: '#ef4444',
  statusInactive: '#94a3b8',
  edgeOwner: '#0f766e',
  edgeRoutes: '#1d4ed8',
  edgeSelector: '#4f46e5',
  edgeEndpoint: '#60a5fa',
  edgeVolumeBinding: '#7e22ce',
  edgeStorageClass: '#65a30d',
  edgeMounts: '#c084fc',
  edgeSchedules: '#16a34a',
  edgeScales: '#eab308',
  edgeGrants: '#ea580c',
  edgeBinds: '#9333ea',
  edgeAggregates: '#db2777',
  edgeFilteredPath: '#ef4444',
  edgeUses: '#6b7280',
  edgeDefault: '#9ca3af',
  edgeLineWidth: 1.5,
  edgeHighlightedLineWidth: 2.5,
  edgeHoveredLineWidth: 4,
  edgeDimmedOpacity: 0.15,
  edgeDash: [4, 3],
  nodeConnectedLineWidth: 1,
  nodeSelectedLineWidth: 1,
  nodeEdgeHoveredLineWidth: 2.5,
  nodeDimmedBackgroundOpacity: 0.25,
  nodeDimmedForegroundOpacity: 0.45,
  tooltipMaxWidth: 220,
  tooltipHeight: 64,
  tooltipOffsetY: 6,
  tooltipArrowWidth: 12,
  tooltipArrowHeight: 6,
  tooltipRadius: 4,
  tooltipSourceY: -56,
  tooltipRelationshipY: -40,
  tooltipTargetY: -24,
  tooltipRelationshipBottomPadding: 2,
  tooltipHorizontalPadding: 12,
  tooltipBadgeGap: 6,
  tooltipBadgeMaxWidth: 118,
  tooltipBadgeMaxFontSize: 10,
  tooltipBadgePaddingX: 5,
  tooltipBadgePaddingY: 2,
  tooltipNameFontSize: 11,
  tooltipNameFontWeight: 600,
  tooltipRelationshipFontSize: 10,
  tooltipRelationshipFontWeight: 400,
  fitViewPadding: 16,
  fullOpacity: 1,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif',
};

const prepareFixture = (nodeCount: number, edgeCount: number) => {
  const payload = createObjectMapPerformanceFixture({ nodeCount, edgeCount });
  const dedupedEdges = dedupeServiceEdges(payload.nodes, payload.edges);
  const reachable = filterByDirectionalReachability(
    payload.nodes,
    dedupedEdges,
    payload.nodes[0].id
  );
  const collapseInfo = computeCollapseInfo(
    reachable.nodes,
    reachable.edges,
    payload.nodes[0].id,
    new Set()
  );
  const visible = filterByCollapseInfo(
    reachable.nodes,
    reachable.edges,
    collapseInfo.visibleNodeIds
  );
  const layout = computeObjectMapLayout(visible.nodes, visible.edges, payload.nodes[0].id);
  const graphData = toObjectMapG6Data(layout, EMPTY_SELECTION, () => null, PALETTE);
  return { payload, visible, layout, graphData };
};

const measure = <T>(fn: () => T): { result: T; durationMs: number } => {
  const startedAt = performance.now();
  const result = fn();
  return { result, durationMs: performance.now() - startedAt };
};

describe('object map performance fixtures', () => {
  it('builds deterministic large fixtures with complete object references', () => {
    const payload = createObjectMapPerformanceFixture({ nodeCount: 500, edgeCount: 1000 });

    expect(payload.nodes).toHaveLength(500);
    expect(payload.edges).toHaveLength(1000);
    expect(payload.seed).toEqual(payload.nodes[0].ref);
    expect(payload.nodes[499].ref).toEqual(
      expect.objectContaining({
        clusterId: 'perf-cluster',
        group: expect.any(String),
        kind: expect.any(String),
        version: expect.any(String),
      })
    );
  });

  it('prepares a 500 node / 1000 edge map within the interaction budget smoke threshold', () => {
    const { result, durationMs } = measure(() => prepareFixture(500, 1000));

    expect(result.visible.nodes).toHaveLength(500);
    expect(result.visible.edges).toHaveLength(1000);
    expect(result.layout.nodes).toHaveLength(500);
    expect(result.layout.edges).toHaveLength(1000);
    expect(result.graphData.nodes).toHaveLength(500);
    expect(result.graphData.edges).toHaveLength(1000);
    expect(durationMs).toBeLessThan(1000);
  });

  it('prepares a 1000 node / 2000 edge map without pathological growth', () => {
    const { result, durationMs } = measure(() => prepareFixture(1000, 2000));

    expect(result.visible.nodes).toHaveLength(1000);
    expect(result.visible.edges).toHaveLength(2000);
    expect(result.layout.nodes).toHaveLength(1000);
    expect(result.layout.edges).toHaveLength(2000);
    expect(result.graphData.nodes).toHaveLength(1000);
    expect(result.graphData.edges).toHaveLength(2000);
    expect(durationMs).toBeLessThan(3000);
  });

  it('computes large-map selection highlighting within an interaction budget', () => {
    const { result } = measure(() => prepareFixture(1000, 2000));
    const activeNodeId = result.layout.nodes[500].id;

    const selection = measure(() =>
      computeObjectMapSelectionState(result.layout.edges, activeNodeId)
    );

    expect(selection.result.activeId).toBe(activeNodeId);
    expect(selection.result.connectedIds.size).toBeGreaterThan(0);
    expect(selection.result.connectedEdgeIds.size).toBeGreaterThan(0);
    expect(selection.durationMs).toBeLessThan(100);
  });

  it('reroutes edges after a large-map node drag within an interaction budget', () => {
    const { result } = measure(() => prepareFixture(1000, 2000));
    const movedNodes = result.layout.nodes.map((node, index) =>
      index === 500 ? { ...node, x: node.x + 80, y: node.y + 40 } : node
    );

    const rerouted = measure(() => routeObjectMapEdges(movedNodes, result.visible.edges));

    expect(rerouted.result).toHaveLength(2000);
    expect(rerouted.durationMs).toBeLessThan(100);
  });
});
