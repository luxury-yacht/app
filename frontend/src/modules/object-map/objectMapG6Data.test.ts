import { describe, expect, it } from 'vitest';
import type { ObjectMapReference } from '@core/refresh/types';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';
import {
  objectMapG6EdgeState,
  objectMapG6EdgeStroke,
  objectMapG6NodeState,
  parseObjectMapG6Path,
  toObjectMapG6Data,
} from './objectMapG6Data';
import { OBJECT_MAP_G6_CARD_NODE, OBJECT_MAP_G6_PATH_EDGE } from './objectMapG6Constants';
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
  isSeed = false
): PositionedNode => ({
  id,
  x,
  y: 20,
  width: 220,
  height: 64,
  column: x / 320,
  isSeed,
  ref: ref(kind, name, kind === 'Node' ? undefined : 'default'),
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
    node('deploy', 'Deployment', 'web', 0, true),
    node('pod', 'Pod', 'web-abc', 320),
    node('node', 'Node', 'ip-10-0-0-1.ec2.internal', -320),
  ],
  edges: [edge('edge-owner', 'deploy', 'pod', 'owner'), edge('edge-uses', 'pod', 'node', 'uses')],
  bounds: { minX: -320, minY: 20, maxX: 540, maxY: 84 },
};

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

describe('objectMapG6Data', () => {
  it('maps edge types to stable canvas strokes', () => {
    expect(objectMapG6EdgeStroke('owner', palette)).toBe('#2563eb');
    expect(objectMapG6EdgeStroke(' routes ', palette)).toBe('#1d4ed8');
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

  it('builds preset-positioned graph data with node metadata, badges, and edge metadata', () => {
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
      })
    );
    expect(deploy?.style).toEqual(
      expect.objectContaining({
        x: 110,
        y: 52,
        size: [220, 64],
        label: false,
        cardKindText: 'DEPLOYMENT',
        cardNameText: 'web',
        cardNamespaceText: 'default',
      })
    );

    const clusterScoped = graphData.nodes?.find((entry) => entry.id === 'node');
    expect(clusterScoped?.data).toEqual(
      expect.objectContaining({ namespaceLabel: 'cluster-scoped' })
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
});
