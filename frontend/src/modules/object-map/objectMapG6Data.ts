/**
 * frontend/src/modules/object-map/objectMapG6Data.ts
 *
 * Converts object-map layout data into G6 nodes, edges, and element states.
 */

import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { PathArray } from '@antv/g6';
import type { KindBadgeVisualStyle } from '@shared/utils/kindBadgeColors';
import { fallbackKindBadgeVisualStyle } from '@shared/utils/kindBadgeColors';
import { formatAge } from '@/utils/ageFormatter';
import { getDisplayKind } from '@/utils/kindAliasMap';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';
import { OBJECT_MAP_CARD_STYLE } from './objectMapCardStyle';
import {
  OBJECT_MAP_G6_CARD_NODE,
  OBJECT_MAP_G6_PATH_EDGE,
  type ObjectMapG6CardDetailLevel,
  type ObjectMapG6EdgeDetailLevel,
} from './objectMapG6Constants';
import type { ObjectMapNodeBadgeLookup, ObjectMapSelectionState } from './objectMapRendererTypes';

const NODE_NAMESPACE_MAX_CHARS = 28;
const NODE_CARD_RADIUS = OBJECT_MAP_CARD_STYLE.borderRadius;
const NODE_LINE_WIDTH = 1;
const NODE_SEED_LINE_WIDTH = 2;

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
  statusHealthy: string;
  statusRefreshing: string;
  statusDegraded: string;
  statusUnhealthy: string;
  statusInactive: string;
  edgeOwner: string;
  edgeRoutes: string;
  edgeSelector: string;
  edgeEndpoint: string;
  edgeVolumeBinding: string;
  edgeStorageClass: string;
  edgeMounts: string;
  edgeSchedules: string;
  edgeScales: string;
  edgeGrants: string;
  edgeBinds: string;
  edgeAggregates: string;
  edgeFilteredPath: string;
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
  nodeDimmedBackgroundOpacity: number;
  nodeDimmedForegroundOpacity: number;
  tooltipMaxWidth: number;
  tooltipHeight: number;
  tooltipOffsetY: number;
  tooltipArrowWidth: number;
  tooltipArrowHeight: number;
  tooltipRadius: number;
  tooltipSourceY: number;
  tooltipRelationshipY: number;
  tooltipTargetY: number;
  tooltipRelationshipBottomPadding: number;
  tooltipHorizontalPadding: number;
  tooltipBadgeGap: number;
  tooltipBadgeMaxWidth: number;
  tooltipBadgeMaxFontSize: number;
  tooltipBadgePaddingX: number;
  tooltipBadgePaddingY: number;
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

const formatNodeAge = (
  creationTimestamp: string | undefined,
  now?: Date | string | number
): string => {
  if (!creationTimestamp) return '';
  const age = now === undefined ? formatAge(creationTimestamp) : formatAge(creationTimestamp, now);
  return age === '-' ? '' : age;
};

const objectMapStatusFill = (
  status: PositionedNode['status'] | undefined,
  palette: ObjectMapG6Palette
): string | undefined => {
  switch (status?.presentation) {
    case 'ready':
      return palette.statusHealthy;
    case 'not-ready':
      return palette.statusUnhealthy;
    case 'cordoned':
    case 'terminating':
    case 'warning':
      return palette.statusDegraded;
    case 'unknown':
      return palette.statusInactive;
    case 'refreshing':
      return palette.statusRefreshing;
    case 'degraded':
      return palette.statusDegraded;
    case 'unhealthy':
    case 'error':
      return palette.statusUnhealthy;
    case 'inactive':
      return palette.statusInactive;
    default:
      return palette.statusInactive;
  }
};

export const objectMapG6EdgeStroke = (type: string, palette: ObjectMapG6Palette): string => {
  switch (type.trim().toLowerCase()) {
    case 'owner':
      return palette.edgeOwner;
    case 'routes':
      return palette.edgeRoutes;
    case 'selector':
      return palette.edgeSelector;
    case 'endpoint':
      return palette.edgeEndpoint;
    case 'volume-binding':
      return palette.edgeVolumeBinding;
    case 'storage-class':
      return palette.edgeStorageClass;
    case 'mounts':
      return palette.edgeMounts;
    case 'schedules':
      return palette.edgeSchedules;
    case 'scales':
      return palette.edgeScales;
    case 'grants':
      return palette.edgeGrants;
    case 'binds':
      return palette.edgeBinds;
    case 'aggregates':
      return palette.edgeAggregates;
    case 'filtered-path':
      return palette.edgeFilteredPath;
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

const objectMapG6SimpleEdgePath = (
  edge: PositionedEdge,
  nodeById: Map<string, PositionedNode>
): PathArray => {
  const source = nodeById.get(edge.sourceId);
  const target = nodeById.get(edge.targetId);
  if (!source || !target) return parseObjectMapG6Path(edge.d);
  return [
    ['M', source.x + source.width / 2, source.y + source.height / 2],
    ['L', target.x + target.width / 2, target.y + target.height / 2],
  ];
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
  palette: ObjectMapG6Palette,
  kindBadgeStyleForKind: (kind: string) => KindBadgeVisualStyle = fallbackKindBadgeVisualStyle,
  useShortResourceNames = false,
  cardDetailLevel: ObjectMapG6CardDetailLevel = 'full',
  edgeDetailLevel: ObjectMapG6EdgeDetailLevel = 'routed',
  ageNow?: Date | string | number
): GraphData => {
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

  return {
    nodes: layout.nodes.map<NodeData>((node) => {
      const badge = badgeForNode(node.id);
      const kindLabel = getDisplayKind(node.ref.kind, useShortResourceNames);
      const namespaceLabel = truncate(formatNamespace(node), NODE_NAMESPACE_MAX_CHARS);
      const ageLabel = formatNodeAge(node.creationTimestamp, ageNow);
      const statusFill = objectMapStatusFill(node.status, palette);
      const kindBadgeStyle = kindBadgeStyleForKind(node.ref.kind);
      const states = objectMapG6NodeState(node, selectionState);
      const isDimmed = states.includes('dimmed');

      return {
        id: node.id,
        type: OBJECT_MAP_G6_CARD_NODE,
        data: {
          ref: node.ref,
          badge,
          kindLabel,
          nameLabel: node.ref.name,
          namespaceLabel,
          ageLabel,
          status: node.status,
        },
        states,
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
          cardBackgroundOpacity: isDimmed
            ? palette.nodeDimmedBackgroundOpacity
            : palette.fullOpacity,
          cardForegroundOpacity: isDimmed
            ? palette.nodeDimmedForegroundOpacity
            : palette.fullOpacity,
          cardDetailLevel,
          cardKindBadgeText: kindLabel.toUpperCase(),
          cardKindBadgeFill: kindBadgeStyle.backgroundColor,
          cardKindBadgeTextFill: kindBadgeStyle.color,
          cardKindBadgeStroke: kindBadgeStyle.borderColor,
          cardKindBadgeBorderWidth: kindBadgeStyle.borderWidth,
          cardKindBadgeRadius: kindBadgeStyle.borderRadius,
          cardKindBadgeFontSize: kindBadgeStyle.fontSize,
          cardKindBadgeFontWeight: kindBadgeStyle.fontWeight,
          cardKindBadgeLetterSpacing: kindBadgeStyle.letterSpacing,
          cardKindBadgePaddingX: kindBadgeStyle.paddingX,
          cardKindBadgePaddingY: kindBadgeStyle.paddingY,
          cardCollapseBadgeText: badge
            ? badge.expanded
              ? '\u2212'
              : `+${badge.hiddenCount}`
            : undefined,
          cardCollapseBadgeFill: palette.backgroundSecondary,
          cardCollapseBadgeTextFill: palette.textSecondary,
          cardCollapseBadgeStroke: palette.textTertiary,
          cardNameText: node.ref.name,
          cardNamespaceText: namespaceLabel,
          cardAgeText: ageLabel,
          cardStatusText: node.status?.label,
          cardStatusReason: node.status?.reason,
          cardStatusFill: statusFill,
          cardStatusStroke: palette.backgroundSecondary,
          cardFontFamily: palette.fontFamily,
          cardNameFill: palette.text,
          cardNamespaceFill: palette.textSecondary,
          cardAgeFill: palette.textSecondary,
        },
      };
    }),
    edges: layout.edges.map<EdgeData>((edge) => {
      const useSimpleEdge = edgeDetailLevel === 'simple';
      return {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: OBJECT_MAP_G6_PATH_EDGE,
        data: {
          label: edge.label,
          type: edge.type,
          tracedBy: edge.tracedBy,
          filteredPath: edge.filteredPath,
          midX: edge.midX,
          midY: edge.midY,
          path: edge.d,
        },
        states: objectMapG6EdgeState(edge, selectionState),
        style: {
          objectMapEdgeDetailLevel: edgeDetailLevel,
          objectMapPath: useSimpleEdge
            ? objectMapG6SimpleEdgePath(edge, nodeById)
            : parseObjectMapG6Path(edge.d),
          stroke: objectMapG6EdgeStroke(edge.type, palette),
          lineWidth: selectionState.connectedEdgeIds.has(edge.id)
            ? palette.edgeHighlightedLineWidth
            : palette.edgeLineWidth,
          opacity: palette.fullOpacity,
          lineDash:
            !useSimpleEdge &&
            (edge.type.trim().toLowerCase() === 'uses' ||
              edge.type.trim().toLowerCase() === 'filtered-path')
              ? palette.edgeDash
              : undefined,
        },
      };
    }),
  };
};
