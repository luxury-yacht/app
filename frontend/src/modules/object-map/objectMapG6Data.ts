import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { PathArray } from '@antv/g6';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';
import { OBJECT_MAP_G6_CARD_NODE, OBJECT_MAP_G6_PATH_EDGE } from './objectMapG6Constants';
import type { ObjectMapNodeBadgeLookup, ObjectMapSelectionState } from './objectMapRendererTypes';

const NODE_KIND_MAX_CHARS = 26;
const NODE_NAME_MAX_CHARS = 32;
const NODE_NAMESPACE_MAX_CHARS = 28;
const NODE_CARD_RADIUS = 6;
const NODE_LINE_WIDTH = 1;
const NODE_SEED_LINE_WIDTH = 2;
const BADGE_FONT_WEIGHT = 700;
const BADGE_WIDTH = 28;
const BADGE_HEIGHT = 14;
const BADGE_RADIUS = 3;
const BADGE_OFFSET_X = -24;
const BADGE_OFFSET_Y = BADGE_HEIGHT - 8;

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
  edgeDefault: string;
  edgeLineWidth: number;
  edgeHighlightedLineWidth: number;
  edgeHoveredLineWidth: number;
  edgeDimmedOpacity: number;
  edgeDash: [number, number];
  nodeConnectedLineWidth: number;
  nodeSelectedLineWidth: number;
  nodeEdgeHoveredLineWidth: number;
  nodeDimmedOpacity: number;
  tooltipWidth: number;
  tooltipHeight: number;
  tooltipOffsetY: number;
  tooltipArrowWidth: number;
  tooltipArrowHeight: number;
  tooltipRadius: number;
  tooltipSourceY: number;
  tooltipRelationshipY: number;
  tooltipTargetY: number;
  tooltipLabelMaxChars: number;
  tooltipHorizontalPadding: number;
  tooltipNameFontSize: number;
  tooltipNameFontWeight: number;
  tooltipRelationshipFontSize: number;
  tooltipRelationshipFontWeight: number;
  fitViewPadding: number;
  fullOpacity: number;
  fontFamily: string;
}

const truncate = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}\u2026`;
};

const formatNamespace = (node: PositionedNode): string =>
  node.ref.namespace?.trim() ? node.ref.namespace : 'cluster-scoped';

export const objectMapG6EdgeStroke = (type: string, palette: ObjectMapG6Palette): string => {
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
      return palette.edgeDefault;
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
  palette: ObjectMapG6Palette
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
        radius: NODE_CARD_RADIUS,
        fill: palette.backgroundSecondary,
        stroke: node.isSeed ? palette.accent : palette.border,
        lineWidth: node.isSeed ? NODE_SEED_LINE_WIDTH : NODE_LINE_WIDTH,
        opacity: palette.fullOpacity,
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
                offsetX: BADGE_OFFSET_X,
                offsetY: BADGE_OFFSET_Y,
                fill: palette.accent,
                fontWeight: BADGE_FONT_WEIGHT,
                backgroundWidth: BADGE_WIDTH,
                backgroundHeight: BADGE_HEIGHT,
                backgroundFill: palette.accentBg,
                backgroundStroke: palette.accent,
                backgroundRadius: BADGE_RADIUS,
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
      stroke: objectMapG6EdgeStroke(edge.type, palette),
      lineWidth: selectionState.connectedEdgeIds.has(edge.id)
        ? palette.edgeHighlightedLineWidth
        : palette.edgeLineWidth,
      opacity: palette.fullOpacity,
      lineDash: edge.type.trim().toLowerCase() === 'uses' ? palette.edgeDash : undefined,
    },
  })),
});
