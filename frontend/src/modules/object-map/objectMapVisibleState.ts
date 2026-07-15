/**
 * frontend/src/modules/object-map/objectMapVisibleState.ts
 *
 * Derives the visible object-map layout after kind filtering, relationship
 * filtering, focus mode, and search are applied.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import {
  ALL_MULTISELECT_FILTER,
  filterSelectionValues,
  type MultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { OBJECT_MAP_EDGE_KINDS } from './objectMapEdgeStyle';
import { contractObjectMapKindFilter, FILTERED_PATH_EDGE_TYPE } from './objectMapKindFilter';
import {
  computeObjectMapBounds,
  computeObjectMapLayout,
  type ObjectMapLayout,
  type PositionedEdge,
  type PositionedNode,
  routeObjectMapEdges,
} from './objectMapLayout';
import type { ObjectMapSelectionState } from './objectMapRendererTypes';
import { computeObjectMapSelectionState } from './objectMapSelection';

export interface ObjectMapVisibleStateInput {
  layout: ObjectMapLayout;
  seedNodeId: string;
  activeNodeId: string | null;
  focusMode: boolean;
  selectedKinds: MultiSelectFilterSelection;
  enabledEdgeTypes: Set<string> | null;
  searchQuery: string;
  useShortResourceNames: boolean;
}

export interface ObjectMapVisibleState {
  hasSelectedKinds: boolean;
  realEdgeTypes: Set<string>;
  visibleEdgeTypes: Set<string>;
  legendEntries: typeof OBJECT_MAP_EDGE_KINDS;
  kindOptions: DropdownOption[];
  visibleLayout: ObjectMapLayout;
  visibleSelectionState: ObjectMapSelectionState;
  normalizedSearchQuery: string;
  searchMatches: PositionedNode[];
}

const toLayoutNodeInput = (node: PositionedNode): ObjectMapNode => ({
  id: node.id,
  depth: Math.abs(node.column),
  ref: node.ref,
  creationTimestamp: node.creationTimestamp,
  status: node.status,
});

const toLayoutEdgeInput = (
  edge: PositionedEdge
): ObjectMapEdge & Pick<PositionedEdge, 'filteredPath'> => ({
  id: edge.id,
  source: edge.sourceId,
  target: edge.targetId,
  type: edge.type,
  label: edge.label,
  tracedBy: edge.tracedBy,
  filteredPath: edge.filteredPath,
});

const computeRealEdgeTypes = (edges: PositionedEdge[]): Set<string> => {
  const types = new Set<string>();
  edges.forEach((edge) => {
    types.add(edge.type.trim().toLowerCase());
  });
  return types;
};

const computeVisibleEdgeTypes = (
  realEdgeTypes: Set<string>,
  hasSelectedKinds: boolean
): Set<string> => {
  const types = new Set(realEdgeTypes);
  if (hasSelectedKinds) {
    types.add(FILTERED_PATH_EDGE_TYPE);
  }
  return types;
};

const computeKindOptions = (
  nodes: PositionedNode[],
  useShortResourceNames: boolean
): DropdownOption[] => {
  const kinds = Array.from(new Set(nodes.map((node) => node.ref.kind))).sort((a, b) =>
    a.localeCompare(b)
  );
  return kinds.map((kind) => ({
    value: kind,
    label: getDisplayKind(kind, useShortResourceNames),
  }));
};

const applyEdgeTypeFilter = (
  layout: ObjectMapLayout,
  enabledEdgeTypes: Set<string> | null
): ObjectMapLayout => {
  if (!enabledEdgeTypes) {
    return layout;
  }
  return {
    ...layout,
    edges: layout.edges.filter((edge) => enabledEdgeTypes.has(edge.type)),
  };
};

const applyKindFilter = ({
  layout,
  selectedKindSet,
  enabledEdgeTypes,
  seedNodeId,
}: {
  layout: ObjectMapLayout;
  selectedKindSet: Set<string>;
  enabledEdgeTypes: Set<string> | null;
  seedNodeId: string;
}): ObjectMapLayout => {
  if (selectedKindSet.size === 0) {
    return layout;
  }

  const contracted = contractObjectMapKindFilter(
    layout.nodes.map(toLayoutNodeInput),
    layout.edges.map(toLayoutEdgeInput),
    selectedKindSet
  );
  const edges = contracted.edges.filter(
    (edge) =>
      edge.type !== FILTERED_PATH_EDGE_TYPE ||
      !enabledEdgeTypes ||
      enabledEdgeTypes.has(FILTERED_PATH_EDGE_TYPE)
  );

  return computeObjectMapLayout(
    contracted.nodes,
    edges,
    contracted.nodes.some((node) => node.id === seedNodeId)
      ? seedNodeId
      : (contracted.nodes[0]?.id ?? '')
  );
};

const applyFocusMode = (
  layout: ObjectMapLayout,
  focusMode: boolean,
  activeNodeId: string | null
): ObjectMapLayout => {
  const activeNode = activeNodeId
    ? (layout.nodes.find((node) => node.id === activeNodeId) ?? null)
    : null;
  if (!focusMode || !activeNodeId || !activeNode) {
    return layout;
  }

  const focusSelectionState = computeObjectMapSelectionState(layout.edges, activeNodeId);
  const visibleNodeIds = new Set<string>([activeNodeId, ...focusSelectionState.connectedIds]);
  const focusedNodes = layout.nodes.filter((node) => visibleNodeIds.has(node.id));
  const focusedEdges = layout.edges.filter((edge) =>
    focusSelectionState.connectedEdgeIds.has(edge.id)
  );
  const focusedEdgeInputs = focusedEdges.map(toLayoutEdgeInput);

  const focusedLayout = computeObjectMapLayout(
    focusedNodes.map(toLayoutNodeInput),
    focusedEdgeInputs,
    activeNodeId
  );
  const focusedActiveNode = focusedLayout.nodes.find((node) => node.id === activeNodeId);
  if (!focusedActiveNode) {
    return focusedLayout;
  }

  const dx = activeNode.x - focusedActiveNode.x;
  const dy = activeNode.y - focusedActiveNode.y;
  if (dx === 0 && dy === 0) {
    return focusedLayout;
  }

  const nodes = focusedLayout.nodes.map((node) => ({
    ...node,
    x: node.x + dx,
    y: node.y + dy,
  }));
  return {
    nodes,
    edges: routeObjectMapEdges(nodes, focusedEdgeInputs),
    bounds: computeObjectMapBounds(nodes),
  };
};

const computeSearchMatches = (
  nodes: PositionedNode[],
  normalizedSearchQuery: string,
  useShortResourceNames: boolean
): PositionedNode[] => {
  if (!normalizedSearchQuery) {
    return [];
  }
  return nodes.filter((node) => {
    const namespace = node.ref.namespace ?? '';
    const displayKind = getDisplayKind(node.ref.kind, useShortResourceNames);
    return `${node.ref.kind} ${displayKind} ${namespace} ${node.ref.name}`
      .toLowerCase()
      .includes(normalizedSearchQuery);
  });
};

export const deriveObjectMapVisibleState = ({
  layout,
  seedNodeId,
  activeNodeId,
  focusMode,
  selectedKinds,
  enabledEdgeTypes,
  searchQuery,
  useShortResourceNames,
}: ObjectMapVisibleStateInput): ObjectMapVisibleState => {
  const hasSelectedKinds = selectedKinds.mode === 'some';
  const realEdgeTypes = computeRealEdgeTypes(layout.edges);
  const visibleEdgeTypes = computeVisibleEdgeTypes(realEdgeTypes, hasSelectedKinds);
  const legendEntries = OBJECT_MAP_EDGE_KINDS.filter((entry) => visibleEdgeTypes.has(entry.type));
  const kindOptions = computeKindOptions(layout.nodes, useShortResourceNames);
  const selectedKindSet = new Set(filterSelectionValues(selectedKinds));
  const edgeFilteredLayout = applyEdgeTypeFilter(layout, enabledEdgeTypes);
  const kindFilteredLayout =
    selectedKinds.mode === 'none'
      ? computeObjectMapLayout([], [], '')
      : applyKindFilter({
          layout: edgeFilteredLayout,
          selectedKindSet,
          enabledEdgeTypes,
          seedNodeId,
        });
  const visibleLayout = applyFocusMode(kindFilteredLayout, focusMode, activeNodeId);
  const visibleSelectionState = computeObjectMapSelectionState(visibleLayout.edges, activeNodeId);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchMatches = computeSearchMatches(
    visibleLayout.nodes,
    normalizedSearchQuery,
    useShortResourceNames
  );

  return {
    hasSelectedKinds,
    realEdgeTypes,
    visibleEdgeTypes,
    legendEntries,
    kindOptions,
    visibleLayout,
    visibleSelectionState,
    normalizedSearchQuery,
    searchMatches,
  };
};

export const pruneObjectMapEnabledEdgeTypes = (
  enabledEdgeTypes: Set<string> | null,
  visibleEdgeTypes: Set<string>
): Set<string> | null => {
  if (!enabledEdgeTypes) {
    return null;
  }
  const next = new Set(Array.from(enabledEdgeTypes).filter((type) => visibleEdgeTypes.has(type)));
  return next.size === enabledEdgeTypes.size ? enabledEdgeTypes : next;
};

export const pruneObjectMapSelectedKinds = (
  selectedKinds: MultiSelectFilterSelection,
  kindOptions: DropdownOption[]
): MultiSelectFilterSelection => {
  if (selectedKinds.mode !== 'some') {
    return selectedKinds;
  }
  const available = new Set(kindOptions.map((option) => option.value));
  const next = selectedKinds.values.filter((kind) => available.has(kind));
  if (next.length === selectedKinds.values.length) {
    return selectedKinds;
  }
  return next.length > 0 ? { mode: 'some', values: next } : ALL_MULTISELECT_FILTER;
};
