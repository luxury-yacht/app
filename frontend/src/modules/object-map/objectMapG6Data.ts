import type { EdgeData, GraphData, NodeData } from '@antv/g6';
import type { ObjectMapLayout, PositionedEdge, PositionedNode } from './objectMapLayout';
import { OBJECT_MAP_G6_CARD_NODE } from './objectMapG6Constants';
import type { ObjectMapNodeBadgeLookup, ObjectMapSelectionState } from './objectMapRendererTypes';

const NODE_KIND_MAX_CHARS = 26;
const NODE_NAME_MAX_CHARS = 32;
const NODE_NAMESPACE_MAX_CHARS = 28;

const truncate = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}\u2026`;
};

const formatNamespace = (node: PositionedNode): string =>
  node.ref.namespace?.trim() ? node.ref.namespace : 'cluster-scoped';

export const objectMapG6EdgeStroke = (type: string): string => {
  switch (type.trim().toLowerCase()) {
    case 'owner':
      return '#2563eb';
    case 'routes':
      return '#1d4ed8';
    case 'selector':
      return '#2563eb';
    case 'endpoint':
      return '#60a5fa';
    case 'storage':
      return '#7e22ce';
    case 'mounts':
      return '#c084fc';
    case 'schedules':
      return '#16a34a';
    case 'scales':
      return '#eab308';
    case 'uses':
      return '#6b7280';
    default:
      return '#9ca3af';
  }
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
  badgeForNode: ObjectMapNodeBadgeLookup
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
        fill: '#f8fafc',
        stroke: node.isSeed ? '#2563eb' : '#cbd5e1',
        lineWidth: node.isSeed ? 2 : 1,
        label: false,
        cardKindText: kindLabel.toUpperCase(),
        cardNameText: nameLabel,
        cardNamespaceText: namespaceLabel,
        cardKindFill: '#2563eb',
        cardNameFill: '#0f172a',
        cardNamespaceFill: '#64748b',
        badges: badge
          ? [
              {
                text: badge.expanded ? '\u2212' : `+${badge.hiddenCount}`,
                placement: 'right-top',
                fill: '#2563eb',
                fontWeight: 700,
                backgroundWidth: 28,
                backgroundHeight: 16,
                backgroundFill: '#dbeafe',
                backgroundStroke: '#2563eb',
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
    data: {
      label: edge.label,
      type: edge.type,
      tracedBy: edge.tracedBy,
      midX: edge.midX,
      midY: edge.midY,
    },
    states: objectMapG6EdgeState(edge, selectionState),
    style: {
      stroke: objectMapG6EdgeStroke(edge.type),
      lineWidth: selectionState.connectedEdgeIds.has(edge.id) ? 2.5 : 1.5,
      lineDash: edge.type.trim().toLowerCase() === 'uses' ? [4, 3] : undefined,
    },
  })),
});
