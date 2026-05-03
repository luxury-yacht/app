import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { PathArray } from '@antv/g6';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';
import { OBJECT_MAP_G6_CARD_NODE, OBJECT_MAP_G6_PATH_EDGE } from './objectMapG6Constants';
import type { ObjectMapNodeBadgeLookup, ObjectMapSelectionState } from './objectMapRendererTypes';

const NODE_KIND_MAX_CHARS = 26;
const NODE_NAME_MAX_CHARS = 32;
const NODE_NAMESPACE_MAX_CHARS = 28;

export interface ObjectMapG6Palette {
  accent: string;
  accentBg: string;
  background: string;
  backgroundSecondary: string;
  border: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  edgeRoutes: string;
  edgeEndpoint: string;
  edgeStorage: string;
  edgeMounts: string;
  edgeSchedules: string;
  edgeScales: string;
  edgeUses: string;
  fontFamily: string;
}

export const DEFAULT_OBJECT_MAP_G6_PALETTE: ObjectMapG6Palette = {
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
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif',
};

const truncate = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}\u2026`;
};

const formatNamespace = (node: PositionedNode): string =>
  node.ref.namespace?.trim() ? node.ref.namespace : 'cluster-scoped';

export const objectMapG6EdgeStroke = (type: string): string => {
  return objectMapG6EdgeStrokeForPalette(type, DEFAULT_OBJECT_MAP_G6_PALETTE);
};

const objectMapG6EdgeStrokeForPalette = (type: string, palette: ObjectMapG6Palette): string => {
  switch (type.trim().toLowerCase()) {
    case 'owner':
      return palette.accent;
    case 'routes':
      return palette.edgeRoutes;
    case 'selector':
      return palette.accent;
    case 'endpoint':
      return palette.edgeEndpoint;
    case 'storage':
      return palette.edgeStorage;
    case 'mounts':
      return palette.edgeMounts;
    case 'schedules':
      return palette.edgeSchedules;
    case 'scales':
      return palette.edgeScales;
    case 'uses':
      return palette.edgeUses;
    default:
      return palette.textTertiary;
  }
};

export const parseObjectMapG6Path = (path: string): PathArray => {
  const tokens = path.match(/[MCL]|-?\d+(?:\.\d+)?/g) ?? [];
  let result: PathArray = [['M', 0, 0]];
  let hasSegment = false;
  const append = (segment: PathArray[number]) => {
    if (!hasSegment && segment[0] === 'M') {
      result = [segment];
    } else if (!hasSegment) {
      result = [['M', 0, 0], segment];
    } else {
      result.push(segment);
    }
    hasSegment = true;
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const command = tokens[index];
    if (command === 'M' || command === 'L') {
      append([command, Number(tokens[index + 1]), Number(tokens[index + 2])]);
      index += 2;
    } else if (command === 'C') {
      append([
        'C',
        Number(tokens[index + 1]),
        Number(tokens[index + 2]),
        Number(tokens[index + 3]),
        Number(tokens[index + 4]),
        Number(tokens[index + 5]),
        Number(tokens[index + 6]),
      ]);
      index += 6;
    }
  }
  return result;
};

export const objectMapG6NodeState = (
  node: PositionedNode,
  selectionState: ObjectMapSelectionState
): string[] => {
  const states: string[] = [];
  if (node.isSeed) states.push('seed');
  if (selectionState.activeId === node.id) {
    states.push('selected');
  } else if (selectionState.activeId !== null) {
    states.push(selectionState.connectedIds.has(node.id) ? 'connected' : 'dimmed');
  }
  return states;
};

export const objectMapG6EdgeState = (
  edge: PositionedEdge,
  selectionState: ObjectMapSelectionState
): string[] => {
  if (selectionState.activeId === null) return [];
  return [selectionState.connectedEdgeIds.has(edge.id) ? 'highlighted' : 'dimmed'];
};

export const toObjectMapG6Data = (
  layout: ObjectMapLayout,
  selectionState: ObjectMapSelectionState,
  badgeForNode: ObjectMapNodeBadgeLookup,
  palette: ObjectMapG6Palette = DEFAULT_OBJECT_MAP_G6_PALETTE
): GraphData => ({
  nodes: layout.nodes.map<NodeData>((node) => {
    const badge = badgeForNode(node.id);
    const kindLabel = truncate(node.ref.kind, NODE_KIND_MAX_CHARS);
    const nameLabel = truncate(node.ref.name, NODE_NAME_MAX_CHARS);
    const namespaceLabel = truncate(formatNamespace(node), NODE_NAMESPACE_MAX_CHARS);

    return {
      id: node.id,
      type: OBJECT_MAP_G6_CARD_NODE,
      data: {
        ref: node.ref,
        badge,
        kindLabel,
        nameLabel,
        namespaceLabel,
      },
      states: objectMapG6NodeState(node, selectionState),
      style: {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
        size: [node.width, node.height],
        radius: 6,
        fill: palette.backgroundSecondary,
        stroke: node.isSeed ? palette.accent : palette.border,
        lineWidth: node.isSeed ? 2 : 1,
        opacity: 1,
        label: false,
        cardKindText: kindLabel.toUpperCase(),
        cardNameText: nameLabel,
        cardNamespaceText: namespaceLabel,
        cardFontFamily: palette.fontFamily,
        cardKindFill: palette.accent,
        cardNameFill: palette.text,
        cardNamespaceFill: palette.textSecondary,
        badges: badge
          ? [
              {
                text: badge.expanded ? '\u2212' : `+${badge.hiddenCount}`,
                placement: 'right-top',
                fill: palette.accent,
                fontWeight: 700,
                backgroundWidth: 28,
                backgroundHeight: 16,
                backgroundFill: palette.accentBg,
                backgroundStroke: palette.accent,
                backgroundRadius: 3,
              },
            ]
          : undefined,
      },
    };
  }),
  edges: layout.edges.map<EdgeData>((edge) => ({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    type: OBJECT_MAP_G6_PATH_EDGE,
    data: {
      label: edge.label,
      type: edge.type,
      tracedBy: edge.tracedBy,
      midX: edge.midX,
      midY: edge.midY,
      path: edge.d,
    },
    states: objectMapG6EdgeState(edge, selectionState),
    style: {
      objectMapPath: parseObjectMapG6Path(edge.d),
      stroke: objectMapG6EdgeStrokeForPalette(edge.type, palette),
      lineWidth: selectionState.connectedEdgeIds.has(edge.id) ? 2.5 : 1.5,
      opacity: 1,
      lineDash: edge.type.trim().toLowerCase() === 'uses' ? [4, 3] : undefined,
    },
  })),
});
