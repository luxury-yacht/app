/**
 * frontend/src/modules/object-map/objectMapG6Tooltip.test.ts
 *
 * Tests object-map connection tooltip layout, truncation, and badge rows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KindBadgeVisualStyle } from '@shared/utils/kindBadgeColors';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import type { ObjectMapHoverEdge } from './objectMapRendererTypes';
import { MAX_FILTERED_TOOLTIP_OBJECTS, computeObjectMapTooltipLayout } from './objectMapG6Tooltip';

const palette: ObjectMapG6Palette = {
  accent: '#60a5fa',
  accentBg: '#1d4ed8',
  background: '#111827',
  backgroundSecondary: '#1f2937',
  border: '#374151',
  text: '#f9fafb',
  textSecondary: '#d1d5db',
  textTertiary: '#9ca3af',
  textInverse: '#111827',
  statusHealthy: '#22c55e',
  statusRefreshing: '#16a34a',
  statusDegraded: '#f59e0b',
  statusUnhealthy: '#ef4444',
  statusInactive: '#94a3b8',
  edgeOwner: '#2dd4bf',
  edgeRoutes: '#60a5fa',
  edgeSelector: '#a78bfa',
  edgeEndpoint: '#34d399',
  edgeVolumeBinding: '#f59e0b',
  edgeStorageClass: '#fbbf24',
  edgeMounts: '#a78bfa',
  edgeSchedules: '#f472b6',
  edgeScales: '#22d3ee',
  edgeGrants: '#f97316',
  edgeBinds: '#fb7185',
  edgeAggregates: '#c084fc',
  edgeFilteredPath: '#ef4444',
  edgeUses: '#94a3b8',
  edgeDefault: '#6b7280',
  edgeLineWidth: 1,
  edgeHighlightedLineWidth: 2,
  edgeHoveredLineWidth: 3,
  edgeDimmedOpacity: 0.25,
  edgeDash: [4, 4],
  nodeConnectedLineWidth: 1,
  nodeSelectedLineWidth: 1,
  nodeEdgeHoveredLineWidth: 2,
  nodeDimmedBackgroundOpacity: 0.25,
  nodeDimmedForegroundOpacity: 0.45,
  tooltipMaxWidth: 240,
  tooltipHeight: 70,
  tooltipOffsetY: 10,
  tooltipArrowWidth: 12,
  tooltipArrowHeight: 6,
  tooltipRadius: 4,
  tooltipSourceY: 10,
  tooltipRelationshipY: 28,
  tooltipTargetY: 46,
  tooltipRelationshipBottomPadding: 2,
  tooltipHorizontalPadding: 10,
  tooltipBadgeGap: 6,
  tooltipBadgeMaxWidth: 86,
  tooltipBadgeMaxFontSize: 11,
  tooltipBadgePaddingX: 4,
  tooltipBadgePaddingY: 2,
  tooltipNameFontSize: 12,
  tooltipNameFontWeight: 600,
  tooltipRelationshipFontSize: 11,
  tooltipRelationshipFontWeight: 500,
  fitViewPadding: 30,
  fullOpacity: 1,
  fontFamily: 'Inter',
};

const badgeStyle: KindBadgeVisualStyle = {
  backgroundColor: '#334155',
  borderColor: '#64748b',
  color: '#bfdbfe',
  borderWidth: 1,
  borderRadius: 3,
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 0,
  className: 'kind-badge hash-color-1',
  paddingX: 4,
  paddingY: 2,
};

const hoverEdge = (overrides: Partial<ObjectMapHoverEdge> = {}): ObjectMapHoverEdge => ({
  tooltipX: 100,
  tooltipY: 120,
  sourceLabel: 'frontend',
  sourceKind: 'Service',
  label: 'has endpoints',
  targetLabel: 'frontend-a',
  targetKind: 'Pod',
  type: 'endpoint',
  ...overrides,
});

const ref = (id: string, kind: string, name: string) => ({
  clusterId: 'cluster-a',
  group: '',
  version: 'v1',
  kind,
  namespace: 'default',
  name,
  uid: `${id}-uid`,
});

describe('computeObjectMapTooltipLayout', () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          font: '',
          measureText: (text: string) => ({ width: text.length * 5 }),
        }) as unknown as CanvasRenderingContext2D
    );
  });

  afterEach(() => {
    getContextSpy.mockRestore();
  });

  it('orders normal connection rows as source, relationship, target', () => {
    const layout = computeObjectMapTooltipLayout({
      hoverEdge: hoverEdge(),
      palette,
      useShortResourceNames: false,
      resolveKindBadgeStyle: () => badgeStyle,
    });

    expect(layout.rows).toHaveLength(3);
    expect(layout.rows[0]).toMatchObject({
      type: 'object',
      endpoint: { badgeText: 'SERVICE', text: 'frontend', filtered: false },
    });
    expect(layout.rows[1]).toEqual({
      type: 'relationship',
      edgeType: 'endpoint',
      text: 'has endpoints',
    });
    expect(layout.rows[2]).toMatchObject({
      type: 'object',
      endpoint: { badgeText: 'POD', text: 'frontend-a', filtered: false },
    });
    expect(layout.rowOffsets[2] - layout.rowOffsets[1]).toBe(
      layout.rowGap + palette.tooltipRelationshipBottomPadding
    );
  });

  it('marks filtered path object names as filtered without changing badge text', () => {
    const layout = computeObjectMapTooltipLayout({
      hoverEdge: hoverEdge({
        filteredPath: {
          nodes: [
            { id: 'svc', ref: ref('svc', 'Service', 'frontend'), filtered: false },
            { id: 'slice', ref: ref('slice', 'EndpointSlice', 'frontend-a'), filtered: true },
            { id: 'pod', ref: ref('pod', 'Pod', 'frontend-a'), filtered: false },
          ],
          relationships: [
            { type: 'endpoint', label: 'has endpoints' },
            { type: 'routes', label: 'routes to' },
          ],
          additionalPathCount: 0,
        },
      }),
      palette,
      useShortResourceNames: false,
      resolveKindBadgeStyle: () => badgeStyle,
    });

    expect(layout.rows.map((row) => row.type)).toEqual([
      'object',
      'relationship',
      'object',
      'relationship',
      'object',
    ]);
    expect(layout.rows[2]).toMatchObject({
      type: 'object',
      endpoint: { badgeText: 'ENDPOINTSLICE', text: 'frontend-a', filtered: true },
    });
  });

  it('adds summary rows for hidden filtered-path steps and alternate paths', () => {
    const nodes = Array.from({ length: MAX_FILTERED_TOOLTIP_OBJECTS + 2 }, (_, index) => ({
      id: `node-${index}`,
      ref: ref(`node-${index}`, 'ConfigMap', `config-${index}`),
      filtered: index > 0 && index < MAX_FILTERED_TOOLTIP_OBJECTS + 1,
    }));
    const layout = computeObjectMapTooltipLayout({
      hoverEdge: hoverEdge({
        filteredPath: {
          nodes,
          relationships: nodes.slice(1).map(() => ({ type: 'uses', label: 'uses' })),
          additionalPathCount: 2,
        },
      }),
      palette,
      useShortResourceNames: false,
      resolveKindBadgeStyle: () => badgeStyle,
    });

    expect(layout.rows).toContainEqual({
      type: 'relationship',
      edgeType: 'endpoint',
      text: '+2 hidden steps',
    });
    expect(layout.rows).toContainEqual({
      type: 'relationship',
      edgeType: 'endpoint',
      text: '+2 more hidden paths',
    });
  });

  it('truncates endpoint names and badges by max width only', () => {
    const narrowPalette = {
      ...palette,
      tooltipMaxWidth: 60,
      tooltipBadgeMaxWidth: 18,
    };
    const layout = computeObjectMapTooltipLayout({
      hoverEdge: hoverEdge({
        sourceKind: 'VeryLongKindName',
        sourceLabel: 'very-long-service-name-that-will-not-fit',
      }),
      palette: narrowPalette,
      useShortResourceNames: false,
      resolveKindBadgeStyle: () => badgeStyle,
    });
    const first = layout.rows[0];

    expect(first.type).toBe('object');
    if (first.type !== 'object') return;
    expect(first.endpoint.badgeText).toContain('…');
    expect(first.endpoint.text).toContain('…');
    expect(layout.width).toBeLessThanOrEqual(narrowPalette.tooltipMaxWidth);
  });

  it('does not truncate long kind badges when they fit the badge max width', () => {
    const widePalette = {
      ...palette,
      tooltipMaxWidth: 800,
      tooltipBadgeMaxWidth: 190,
    };
    const layout = computeObjectMapTooltipLayout({
      hoverEdge: hoverEdge({
        sourceKind: 'ClusterRoleBinding',
        sourceLabel: 'system:controller:service-account-token-controller',
      }),
      palette: widePalette,
      useShortResourceNames: false,
      resolveKindBadgeStyle: () => badgeStyle,
    });
    const first = layout.rows[0];

    expect(first.type).toBe('object');
    if (first.type !== 'object') return;
    expect(first.endpoint.badgeText).toBe('CLUSTERROLEBINDING');
    expect(first.endpoint.badgeWidth).toBeLessThanOrEqual(widePalette.tooltipBadgeMaxWidth);
  });

  it('uses the provided badge style resolver for each object row', () => {
    const resolveKindBadgeStyle = vi.fn(() => badgeStyle);

    computeObjectMapTooltipLayout({
      hoverEdge: hoverEdge(),
      palette,
      useShortResourceNames: false,
      resolveKindBadgeStyle,
    });

    expect(resolveKindBadgeStyle).toHaveBeenCalledWith('Service', null);
    expect(resolveKindBadgeStyle).toHaveBeenCalledWith('Pod', null);
  });
});
