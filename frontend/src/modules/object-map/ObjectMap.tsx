/**
 * frontend/src/modules/object-map/ObjectMap.tsx
 *
 * Shell for the object-map snapshot view. Data preparation and interaction
 * state live in `useObjectMapModel`; drawing is delegated to the lazy-loaded
 * G6 renderer so the heavy graph dependency stays out of the initial bundle.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import './ObjectMap.css';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@core/refresh/types';
import { isMacPlatform } from '@/utils/platform';
import ContextMenu from '@shared/components/ContextMenu';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { computeObjectMapLayout } from './objectMapLayout';
import { objectMapEdgeClass, OBJECT_MAP_EDGE_KINDS } from './objectMapEdgeStyle';
import { computeObjectMapSelectionState } from './objectMapSelection';
import type { ObjectMapContextMenuRequest } from './objectMapRendererTypes';
import type { ObjectMapViewportControls } from './objectMapRendererTypes';
import { useObjectMapModel } from './useObjectMapModel';
import {
  AutoFitIcon,
  FitToViewIcon,
  FocusModeIcon,
  LegendIcon,
  RefreshIcon,
  ResetFiltersIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@shared/components/icons/MenuIcons';

const ObjectMapG6Renderer = React.lazy(() => import('./ObjectMapG6Renderer'));

export interface ObjectMapProps {
  payload: ObjectMapSnapshotPayload;
  // Optional refresh callback. When provided, a "Refresh" button
  // appears in the toolbar; the host wires it to whatever fetch flow
  // it owns. Without it, the button is omitted (so the component is
  // still usable in non-fetching contexts like Storybook).
  onRefresh?: () => void;
  // Disables the refresh button while a fetch is in flight.
  isRefreshing?: boolean;
  // Modifier-click handlers. Cmd-click (mac) / Ctrl-click (other) on
  // a node fires `onOpenPanel`; Alt-click fires `onNavigateView`. Both
  // are optional — when omitted the modifier click silently no-ops.
  onOpenPanel?: (ref: ObjectMapReference) => void;
  onNavigateView?: (ref: ObjectMapReference) => void;
  onOpenObjectMap?: (ref: ObjectMapReference) => void;
}

const ObjectMap: React.FC<ObjectMapProps> = ({
  payload,
  onRefresh,
  isRefreshing = false,
  onOpenPanel,
  onNavigateView,
  onOpenObjectMap,
}) => {
  const model = useObjectMapModel(payload);
  const [showLegend, setShowLegend] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<string> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<ObjectMapContextMenuRequest | null>(null);
  const [g6ViewportControls, setG6ViewportControls] = useState<ObjectMapViewportControls | null>(
    null
  );
  const primaryModifierLabel = useMemo(() => (isMacPlatform() ? 'cmd' : 'ctrl'), []);

  const visibleEdgeTypes = useMemo(() => {
    const types = new Set<string>();
    model.layout.edges.forEach((edge) => types.add(edge.type.trim().toLowerCase()));
    return types;
  }, [model.layout.edges]);

  const legendEntries = useMemo(
    () => OBJECT_MAP_EDGE_KINDS.filter((entry) => visibleEdgeTypes.has(entry.type)),
    [visibleEdgeTypes]
  );

  useEffect(() => {
    setEnabledEdgeTypes((previous) => {
      if (!previous) return previous;
      const next = new Set(Array.from(previous).filter((type) => visibleEdgeTypes.has(type)));
      return next.size === previous.size ? previous : next;
    });
  }, [visibleEdgeTypes]);

  const isEdgeTypeEnabled = useCallback(
    (type: string) => !enabledEdgeTypes || enabledEdgeTypes.has(type),
    [enabledEdgeTypes]
  );

  const edgeFilteredLayout = useMemo(() => {
    if (!enabledEdgeTypes) return model.layout;
    return {
      ...model.layout,
      edges: model.layout.edges.filter((edge) => enabledEdgeTypes.has(edge.type)),
    };
  }, [enabledEdgeTypes, model.layout]);

  const visibleLayout = useMemo(() => {
    if (!focusMode || !model.activeNodeId) return edgeFilteredLayout;

    const focusSelectionState = computeObjectMapSelectionState(
      edgeFilteredLayout.edges,
      model.activeNodeId
    );
    const visibleNodeIds = new Set<string>([
      model.activeNodeId,
      ...focusSelectionState.connectedIds,
    ]);

    const focusedNodes = edgeFilteredLayout.nodes.filter((node) => visibleNodeIds.has(node.id));
    const focusedEdges = edgeFilteredLayout.edges.filter((edge) =>
      focusSelectionState.connectedEdgeIds.has(edge.id)
    );

    return computeObjectMapLayout(
      focusedNodes.map((node) => ({
        id: node.id,
        depth: Math.abs(node.column),
        ref: node.ref,
      })),
      focusedEdges.map((edge) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: edge.type,
        label: edge.label,
        tracedBy: edge.tracedBy,
      })),
      model.activeNodeId
    );
  }, [edgeFilteredLayout, focusMode, model.activeNodeId]);

  const visibleSelectionState = useMemo(
    () => computeObjectMapSelectionState(visibleLayout.edges, model.activeNodeId),
    [model.activeNodeId, visibleLayout.edges]
  );

  const toggleEdgeType = useCallback(
    (type: string) => {
      setEnabledEdgeTypes((previous) => {
        const next = new Set(previous ?? Array.from(visibleEdgeTypes));
        if (next.has(type)) {
          next.delete(type);
        } else {
          next.add(type);
        }
        return next.size === visibleEdgeTypes.size ? null : next;
      });
    },
    [visibleEdgeTypes]
  );

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (!normalizedSearchQuery) return [];
    return visibleLayout.nodes.filter((node) => {
      const namespace = node.ref.namespace ?? '';
      return `${node.ref.kind} ${namespace} ${node.ref.name}`
        .toLowerCase()
        .includes(normalizedSearchQuery);
    });
  }, [normalizedSearchQuery, visibleLayout.nodes]);

  useEffect(() => {
    setSearchIndex(0);
  }, [normalizedSearchQuery]);

  const focusSearchMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const nextIndex = Math.min(searchIndex, searchMatches.length - 1);
    const node = searchMatches[nextIndex];
    setSearchIndex((prev) => (prev + 1) % searchMatches.length);
    model.focusNode(node.id);
    g6ViewportControls?.focusNode(node.id);
  }, [g6ViewportControls, model, searchIndex, searchMatches]);

  const viewportControlsReady = Boolean(g6ViewportControls);
  const contextMenuObject = contextMenu?.ref ?? null;
  const objectActions = useObjectActionController({
    context: 'gridtable',
    onOpen: onOpenPanel ? (object) => onOpenPanel(object as ObjectMapReference) : undefined,
    onOpenObjectMap: onOpenObjectMap
      ? (object) => onOpenObjectMap(object as ObjectMapReference)
      : undefined,
  });
  const contextMenuItems = useMemo(
    () => objectActions.getMenuItems(contextMenuObject),
    [contextMenuObject, objectActions]
  );
  const handleNodeContextMenu = useCallback((request: ObjectMapContextMenuRequest) => {
    setContextMenu(request);
  }, []);
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  if (model.layout.nodes.length === 0) {
    return (
      <div className="object-map object-map--empty" data-testid="object-map-empty">
        <p>No related objects found.</p>
      </div>
    );
  }

  return (
    <div className="object-map" data-testid="object-map">
      <div className="object-map__canvas">
        <Suspense fallback={<div className="object-map__message">Loading map renderer…</div>}>
          <ObjectMapG6Renderer
            layout={visibleLayout}
            selectionState={visibleSelectionState}
            hoverEdge={model.hoverEdge}
            onHoverEdge={model.setHoverEdge}
            onClearHoverEdge={model.clearHoverEdge}
            badgeForNode={model.badgeForNode}
            onSelectNode={model.selectNode}
            onToggleGroup={model.toggleGroup}
            onNodeDragStart={model.startNodeDrag}
            onNodeDragMove={model.moveNodeDrag}
            onNodeDragEnd={model.endNodeDrag}
            onClearSelection={model.clearSelection}
            onOpenPanel={onOpenPanel}
            onNavigateView={onNavigateView}
            onNodeContextMenu={handleNodeContextMenu}
            autoFit={model.autoFit}
            onViewportControlsChange={setG6ViewportControls}
          />
        </Suspense>
        <div
          className="object-map__toolbar"
          role="toolbar"
          aria-label="Object map controls"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <form
            className="object-map__search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              focusSearchMatch();
            }}
          >
            <input
              type="search"
              className="object-map__search-input"
              aria-label="Search map objects"
              placeholder="Search objects"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {normalizedSearchQuery && (
              <span className="object-map__search-count">
                {searchMatches.length === 0
                  ? '0/0'
                  : `${Math.min(searchIndex + 1, searchMatches.length)}/${searchMatches.length}`}
              </span>
            )}
          </form>
          <button
            type="button"
            className="object-map__toolbar-button"
            onClick={g6ViewportControls?.zoomOut}
            title="Zoom out"
            aria-label="Zoom out"
            disabled={!viewportControlsReady}
          >
            <ZoomOutIcon />
          </button>
          <button
            type="button"
            className="object-map__toolbar-button"
            onClick={g6ViewportControls?.zoomIn}
            title="Zoom in"
            aria-label="Zoom in"
            disabled={!viewportControlsReady}
          >
            <ZoomInIcon />
          </button>
          <span className="object-map__toolbar-separator" aria-hidden="true" />
          <button
            type="button"
            className="object-map__toolbar-button"
            onClick={g6ViewportControls?.fitToView}
            title="Fit to view"
            aria-label="Fit to view"
            disabled={!viewportControlsReady}
          >
            <FitToViewIcon />
          </button>
          <button
            type="button"
            className={`object-map__toolbar-button ${
              model.autoFit ? 'object-map__toolbar-button--active' : ''
            }`}
            onClick={() => model.setAutoFit((prev) => !prev)}
            title={
              model.autoFit
                ? 'Auto-fit on (viewport recenters when the graph changes)'
                : 'Auto-fit off (your pan/zoom is preserved across changes)'
            }
            aria-label="Toggle auto-fit"
            aria-pressed={model.autoFit}
          >
            <AutoFitIcon />
          </button>
          <button
            type="button"
            className="object-map__toolbar-button"
            onClick={model.resetLayout}
            title="Reset layout"
            aria-label="Reset layout"
            disabled={!model.hasNodePositionOverrides}
          >
            <ResetFiltersIcon />
          </button>
          <span className="object-map__toolbar-separator" aria-hidden="true" />
          <button
            type="button"
            className={`object-map__toolbar-button ${
              focusMode ? 'object-map__toolbar-button--active' : ''
            }`}
            onClick={() => setFocusMode((prev) => !prev)}
            title={focusMode ? 'Focus mode on' : 'Focus mode off'}
            aria-label="Toggle focus mode"
            aria-pressed={focusMode}
          >
            <FocusModeIcon />
          </button>
          {onRefresh && (
            <button
              type="button"
              className="object-map__toolbar-button"
              onClick={onRefresh}
              title="Refresh"
              aria-label="Refresh"
              disabled={isRefreshing}
            >
              <RefreshIcon />
            </button>
          )}
          <button
            type="button"
            className={`object-map__toolbar-button ${
              showLegend ? 'object-map__toolbar-button--active' : ''
            }`}
            onClick={() => setShowLegend((prev) => !prev)}
            title={showLegend ? 'Hide legend' : 'Show legend'}
            aria-label="Toggle legend"
            aria-pressed={showLegend}
          >
            <LegendIcon />
          </button>
        </div>
        {showLegend && (
          <div
            className="object-map__legend"
            role="region"
            aria-label="Object map legend"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {legendEntries.map((entry) => (
              <button
                key={entry.type}
                type="button"
                className={`object-map__legend-row ${
                  isEdgeTypeEnabled(entry.type) ? '' : 'object-map__legend-row--disabled'
                }`}
                onClick={() => toggleEdgeType(entry.type)}
                aria-pressed={isEdgeTypeEnabled(entry.type)}
              >
                <svg className="object-map__legend-swatch" width={26} height={6} aria-hidden="true">
                  <line x1={0} y1={3} x2={26} y2={3} className={objectMapEdgeClass(entry.type)} />
                </svg>
                <span className="object-map__legend-label">{entry.label}</span>
              </button>
            ))}
            {legendEntries.length > 0 && (
              <div className="object-map__legend-separator" aria-hidden="true" />
            )}
            <div className="object-map__legend-shortcut">
              <span className="object-map__legend-key">{primaryModifierLabel}+click</span>
              <span className="object-map__legend-action">Open View</span>
            </div>
            <div className="object-map__legend-shortcut">
              <span className="object-map__legend-key">alt+click</span>
              <span className="object-map__legend-action">Open Object</span>
            </div>
          </div>
        )}
        <div className="object-map__status" aria-live="polite">
          {visibleLayout.nodes.length} objects / {visibleLayout.edges.length} relationships
          {payload.truncated ? ' / truncated' : ''}
        </div>
      </div>
      {contextMenu && contextMenuItems.length > 0 && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu.position}
          onClose={closeContextMenu}
        />
      )}
      {objectActions.modals}
      {payload.truncated && (
        <div className="object-map__banner object-map__banner--truncated">
          Showing {model.layout.nodes.length} of many. Increase the depth/node limits to see more.
        </div>
      )}
      {payload.warnings && payload.warnings.length > 0 && (
        <details className="object-map__warnings">
          <summary>
            {payload.warnings.length} warning{payload.warnings.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {payload.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export default ObjectMap;
