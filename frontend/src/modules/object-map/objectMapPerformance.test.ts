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
  edgeRoutes: '#1d4ed8',
  edgeEndpoint: '#60a5fa',
  edgeStorage: '#7e22ce',
  edgeMounts: '#c084fc',
  edgeSchedules: '#16a34a',
  edgeScales: '#eab308',
  edgeUses: '#6b7280',
  edgeDefault: '#9ca3af',
  edgeLineWidth: 1.5,
  edgeHighlightedLineWidth: 2.5,
  edgeHoveredLineWidth: 4,
  edgeDimmedOpacity: 0.15,
  edgeDash: [4, 3],
  cardRadius: 6,
  cardPaddingX: 10,
  cardKindBaselineY: 18,
  cardNameBaselineY: 38,
  cardNamespaceBaselineY: 56,
  cardKindFontSize: 11,
  cardNameFontSize: 11,
  cardNamespaceFontSize: 11,
  cardKindFontWeight: 600,
  cardNameFontWeight: 600,
  cardNamespaceFontWeight: 400,
  cardKindLetterSpacing: 0.5,
  nodeLineWidth: 1,
  nodeSeedLineWidth: 2,
  nodeConnectedLineWidth: 1.5,
  nodeSelectedLineWidth: 2.5,
  nodeEdgeHoveredLineWidth: 2.5,
  nodeDimmedOpacity: 0.25,
  badgeFontWeight: 700,
  badgeWidth: 28,
  badgeHeight: 16,
  badgeRadius: 3,
  tooltipWidth: 200,
  tooltipHeightSingle: 28,
  tooltipHeightDouble: 44,
  tooltipOffsetY: 4,
  tooltipRadius: 4,
  tooltipLabelYSingle: -14,
  tooltipLabelYDouble: -28,
  tooltipTraceY: -12,
  tooltipLabelMaxChars: 30,
  tooltipTraceMaxChars: 36,
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
