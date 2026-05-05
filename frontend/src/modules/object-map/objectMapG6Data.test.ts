/**
 * frontend/src/modules/object-map/objectMapG6Data.test.ts
 *
 * Tests conversion from object-map layout data into G6 graph data.
 */

import { describe, expect, it } from 'vitest';
import type { ObjectMapReference } from '@core/refresh/types';
import { formatAge } from '@/utils/ageFormatter';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';
import {
  objectMapG6EdgeState,
  objectMapG6EdgeStroke,
  objectMapG6NodeState,
  parseObjectMapG6Path,
  toObjectMapG6Data,
} from './objectMapG6Data';
import {
  OBJECT_MAP_G6_CARD_NODE,
  OBJECT_MAP_G6_PATH_EDGE,
  objectMapG6CardDetailLevelForZoom,
} from './objectMapG6Constants';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import type { ObjectMapSelectionState } from './objectMapRendererTypes';

const ref = (kind: string, name: string, namespace?: string): ObjectMapReference => ({
  clusterId: 'cluster-a',
  group: kind === 'Deployment' ? 'apps' : '',
  version: 'v1',
  kind,
  namespace,
  name,
  uid: `${kind.toLowerCase()}-${name}`,
});

const node = (
  id: string,
  kind: string,
  name: string,
  x: number,
  isSeed = false,
  creationTimestamp?: string
): PositionedNode => ({
  id,
  x,
  y: 20,
  width: 220,
  height: 64,
  column: x / 320,
  isSeed,
  ref: ref(kind, name, kind === 'Node' ? undefined : 'default'),
  creationTimestamp,
});

const edge = (id: string, sourceId: string, targetId: string, type: string): PositionedEdge => ({
  id,
  sourceId,
  targetId,
  type,
  label: `${type} edge`,
  tracedBy: 'trace detail',
  d: 'M 0 0 C 1 1, 2 2, 3 3',
  midX: 160,
  midY: 40,
  sameColumn: false,
});

const selectionState = (activeId: string | null): ObjectMapSelectionState => ({
  activeId,
  connectedIds: new Set(['pod']),
  connectedEdgeIds: new Set(['edge-owner']),
});

const layout: ObjectMapLayout = {
  nodes: [
    node('deploy', 'Deployment', 'web', 0, true, '2024-01-01T00:00:00Z'),
    node('pod', 'Pod', 'web-abc', 320),
    node('node', 'Node', 'ip-10-0-0-1.ec2.internal', -320),
  ],
  edges: [edge('edge-owner', 'deploy', 'pod', 'owner'), edge('edge-uses', 'pod', 'node', 'uses')],
  bounds: { minX: -320, minY: 20, maxX: 540, maxY: 84 },
};

layout.nodes[0].status = { state: 'healthy', label: '2/2 ready' };

const palette: ObjectMapG6Palette = {
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

describe('objectMapG6Data', () => {
  it('maps edge types to stable canvas strokes', () => {
    expect(objectMapG6EdgeStroke('owner', palette)).toBe('#0f766e');
    expect(objectMapG6EdgeStroke(' routes ', palette)).toBe('#1d4ed8');
    expect(objectMapG6EdgeStroke('selector', palette)).toBe('#4f46e5');
    expect(objectMapG6EdgeStroke('volume-binding', palette)).toBe('#7e22ce');
    expect(objectMapG6EdgeStroke('storage-class', palette)).toBe('#65a30d');
    expect(objectMapG6EdgeStroke('grants', palette)).toBe('#ea580c');
    expect(objectMapG6EdgeStroke('binds', palette)).toBe('#9333ea');
    expect(objectMapG6EdgeStroke('aggregates', palette)).toBe('#db2777');
    expect(objectMapG6EdgeStroke('filtered-path', palette)).toBe('#ef4444');
    expect(objectMapG6EdgeStroke('uses', palette)).toBe('#6b7280');
    expect(objectMapG6EdgeStroke('unknown', palette)).toBe('#9ca3af');
  });

  it('computes node and edge states from the shared selection state', () => {
    expect(objectMapG6NodeState(layout.nodes[0], selectionState('deploy'))).toEqual([
      'seed',
      'selected',
    ]);
    expect(objectMapG6NodeState(layout.nodes[1], selectionState('deploy'))).toEqual(['connected']);
    expect(objectMapG6NodeState(layout.nodes[2], selectionState('deploy'))).toEqual(['dimmed']);
    expect(objectMapG6EdgeState(layout.edges[0], selectionState('deploy'))).toEqual([
      'highlighted',
    ]);
    expect(objectMapG6EdgeState(layout.edges[1], selectionState('deploy'))).toEqual(['dimmed']);
    expect(objectMapG6EdgeState(layout.edges[1], selectionState(null))).toEqual([]);
  });

  it('parses routed SVG edge paths for the G6 renderer', () => {
    expect(parseObjectMapG6Path('M 10 20 C 30 20, 40 50, 60 50')).toEqual([
      ['M', 10, 20],
      ['C', 30, 20, 40, 50, 60, 50],
    ]);
  });

  it('builds preset-positioned graph data with node metadata, collapse controls, and edge metadata', () => {
    const graphData = toObjectMapG6Data(
      layout,
      selectionState('deploy'),
      (nodeId) =>
        nodeId === 'deploy' ? { deploymentId: 'deploy', hiddenCount: 2, expanded: false } : null,
      palette
    );

    expect(graphData.nodes).toHaveLength(3);
    expect(graphData.edges).toHaveLength(2);

    const deploy = graphData.nodes?.find((entry) => entry.id === 'deploy');
    expect(deploy?.type).toBe(OBJECT_MAP_G6_CARD_NODE);
    expect(deploy?.data).toEqual(
      expect.objectContaining({
        ref: expect.objectContaining({
          clusterId: 'cluster-a',
          group: 'apps',
          kind: 'Deployment',
          version: 'v1',
          name: 'web',
        }),
        badge: { deploymentId: 'deploy', hiddenCount: 2, expanded: false },
        kindLabel: 'Deployment',
        nameLabel: 'web',
        namespaceLabel: 'default',
        ageLabel: formatAge('2024-01-01T00:00:00Z'),
        status: { state: 'healthy', label: '2/2 ready' },
      })
    );
    expect(deploy?.style).toEqual(
      expect.objectContaining({
        x: 110,
        y: 52,
        size: [220, 64],
        label: false,
        cardBackgroundOpacity: 1,
        cardForegroundOpacity: 1,
        cardDetailLevel: 'full',
        cardKindBadgeText: 'DEPLOYMENT',
        cardKindBadgeFill: 'rgba(100, 116, 139, 0.15)',
        cardCollapseBadgeFill: '#f8fafc',
        cardCollapseBadgeStroke: '#9ca3af',
        cardCollapseBadgeText: '+2',
        cardCollapseBadgeTextFill: '#64748b',
        cardNameText: 'web',
        cardNamespaceText: 'default',
        cardAgeText: formatAge('2024-01-01T00:00:00Z'),
        cardAgeFill: '#64748b',
        cardStatusText: '2/2 ready',
        cardStatusFill: '#22c55e',
        cardStatusStroke: '#f8fafc',
      })
    );
    expect(deploy?.style?.badges).toBeUndefined();

    const clusterScoped = graphData.nodes?.find((entry) => entry.id === 'node');
    expect(clusterScoped?.data).toEqual(
      expect.objectContaining({ namespaceLabel: 'cluster-scoped' })
    );
    expect(clusterScoped?.style).toEqual(
      expect.objectContaining({
        cardBackgroundOpacity: 0.25,
        cardForegroundOpacity: 0.45,
      })
    );

    const uses = graphData.edges?.find((entry) => entry.id === 'edge-uses');
    expect(uses?.type).toBe(OBJECT_MAP_G6_PATH_EDGE);
    expect(uses?.data).toEqual(
      expect.objectContaining({
        label: 'uses edge',
        type: 'uses',
        tracedBy: 'trace detail',
        midX: 160,
        midY: 40,
        path: 'M 0 0 C 1 1, 2 2, 3 3',
      })
    );
    expect(uses?.style).toEqual(
      expect.objectContaining({
        lineDash: [4, 3],
        objectMapPath: [
          ['M', 0, 0],
          ['C', 1, 1, 2, 2, 3, 3],
        ],
      })
    );
  });

  it('uses the centralized kind badge style resolver for card kind badges', () => {
    const graphData = toObjectMapG6Data(
      layout,
      selectionState(null),
      () => null,
      palette,
      (kind) => ({
        className: `kind-badge ${kind}`,
        backgroundColor: '#123456',
        color: '#abcdef',
        borderColor: '#fedcba',
        borderWidth: 2,
        borderRadius: 5,
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 1,
        paddingX: 6,
        paddingY: 3,
      })
    );

    const deploy = graphData.nodes?.find((entry) => entry.id === 'deploy');
    expect(deploy?.style).toEqual(
      expect.objectContaining({
        cardKindBadgeFill: '#123456',
        cardKindBadgeTextFill: '#abcdef',
        cardKindBadgeStroke: '#fedcba',
        cardKindBadgeBorderWidth: 2,
        cardKindBadgeRadius: 5,
        cardKindBadgeFontSize: 10,
        cardKindBadgeFontWeight: '700',
        cardKindBadgeLetterSpacing: 1,
        cardKindBadgePaddingX: 6,
        cardKindBadgePaddingY: 3,
      })
    );
  });

  it('uses short resource names for card kind labels when enabled', () => {
    const graphData = toObjectMapG6Data(
      layout,
      selectionState(null),
      () => null,
      palette,
      undefined,
      true
    );

    const deploy = graphData.nodes?.find((entry) => entry.id === 'deploy');
    expect(deploy?.data).toEqual(
      expect.objectContaining({
        kindLabel: 'deploy',
        nameLabel: 'web',
      })
    );
    expect(deploy?.style).toEqual(
      expect.objectContaining({
        cardKindBadgeText: 'DEPLOY',
        cardNameText: 'web',
      })
    );
  });

  it('maps zoom levels to card detail levels', () => {
    expect(objectMapG6CardDetailLevelForZoom(1)).toBe('full');
    expect(objectMapG6CardDetailLevelForZoom(0.75)).toBe('full');
    expect(objectMapG6CardDetailLevelForZoom(0.63)).toBe('compact');
    expect(objectMapG6CardDetailLevelForZoom(0.45)).toBe('compact');
    expect(objectMapG6CardDetailLevelForZoom(0.3)).toBe('minimal');
    expect(objectMapG6CardDetailLevelForZoom(0.19)).toBe('dot');
  });

  it('passes the requested card detail level to G6 nodes', () => {
    const graphData = toObjectMapG6Data(
      layout,
      selectionState(null),
      () => null,
      palette,
      undefined,
      false,
      'compact'
    );

    expect(graphData.nodes?.[0].style).toEqual(
      expect.objectContaining({ cardDetailLevel: 'compact' })
    );
  });

  it('uses simple straight link paths without dashes when requested', () => {
    const graphData = toObjectMapG6Data(
      layout,
      selectionState(null),
      () => null,
      palette,
      undefined,
      false,
      'full',
      'simple'
    );

    const uses = graphData.edges?.find((entry) => entry.id === 'edge-uses');
    expect(uses?.style).toEqual(
      expect.objectContaining({
        objectMapEdgeDetailLevel: 'simple',
        lineDash: undefined,
        objectMapPath: [
          ['M', 430, 52],
          ['L', -210, 52],
        ],
      })
    );
  });

  it('leaves long kind and object names intact before renderer width-based truncation', () => {
    const longKind = 'VeryLongCustomResourceKindName';
    const longName = 'object-name-that-is-longer-than-the-old-fixed-character-limit';
    const graphData = toObjectMapG6Data(
      {
        ...layout,
        nodes: [node('custom', longKind, longName, 0, true)],
        edges: [],
      },
      selectionState(null),
      () => null,
      palette
    );

    const custom = graphData.nodes?.find((entry) => entry.id === 'custom');
    expect(custom?.data).toEqual(
      expect.objectContaining({
        kindLabel: longKind,
        nameLabel: longName,
      })
    );
    expect(custom?.style).toEqual(
      expect.objectContaining({
        cardKindBadgeText: longKind.toUpperCase(),
        cardNameText: longName,
      })
    );
  });
});
