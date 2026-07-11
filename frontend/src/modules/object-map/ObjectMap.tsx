/**
 * frontend/src/modules/object-map/ObjectMap.tsx
 *
 * Shell for the object-map snapshot view. Data preparation and interaction
 * state live in `useObjectMapModel`; drawing is delegated to the lazy-loaded
 * G6 renderer so the heavy graph dependency stays out of the initial bundle.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import './ObjectMap.css';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@core/refresh/types';
import ContextMenu, { type ContextMenuItem } from '@shared/components/ContextMenu';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import {
  AutoFitIcon,
  FitToViewIcon,
  FocusModeIcon,
  LegendIcon,
  ObjectMapLegendSwatchIcon,
  ResetZoomIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@shared/components/icons/ObjectMapIcons';
import { CloseIcon, RefreshIcon, ResetFiltersIcon } from '@shared/components/icons/SharedIcons';
import Tooltip from '@shared/components/Tooltip';

import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import type { ObjectActionData } from '@shared/hooks/useObjectActions';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import { useShortNames } from '@/hooks/useShortNames';
import {
  createObjectMapDebugId,
  publishObjectMapDebugSnapshot,
  removeObjectMapDebugSnapshot,
  useObjectMapDebugOverlayVisible,
} from './objectMapDebugStore';
import type { EdgeKindMeta } from './objectMapEdgeStyle';
import { OBJECT_MAP_EDGE_FAMILY_LABELS, objectMapEdgeClass } from './objectMapEdgeStyle';
import { normalizeObjectMapPayload } from './objectMapPayload';
import type {
  ObjectMapContextMenuRequest,
  ObjectMapViewportControls,
} from './objectMapRendererTypes';
import {
  deriveObjectMapVisibleState,
  pruneObjectMapEnabledEdgeTypes,
  pruneObjectMapSelectedKinds,
} from './objectMapVisibleState';
import { useObjectMapLegendDrag } from './useObjectMapLegendDrag';
import { useObjectMapModel } from './useObjectMapModel';

const ObjectMapG6Renderer = React.lazy(() => import('./ObjectMapG6Renderer'));

const objectMapTimingNow = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

type ObjectMapMenuState =
  | { type: 'object'; request: ObjectMapContextMenuRequest }
  | { type: 'canvas'; position: { x: number; y: number } };

type ObjectMapLegendGroup = {
  family: EdgeKindMeta['family'];
  label: string;
  entries: EdgeKindMeta[];
};

const objectMapReferenceKey = (ref: ObjectMapReference): string =>
  [
    ref.clusterId,
    ref.group,
    ref.version,
    ref.kind,
    ref.namespace ?? '',
    ref.name,
    ref.uid ?? '',
  ].join('\u0000');

export interface ObjectMapProps {
  payload: ObjectMapSnapshotPayload;
  // Optional refresh callback. When provided, a "Refresh" button
  // appears in the toolbar; the host wires it to whatever fetch flow
  // it owns. Without it, the button is omitted (so the component is
  // still usable in non-fetching contexts like Storybook).
  onRefresh?: () => void;
  // Disables the refresh button while a fetch is in flight.
  isRefreshing?: boolean;
  // Modifier-click handlers. Cmd-click (mac) / Ctrl-click (other) opens
  // details, Shift-click opens the map, and Alt-click navigates to the table.
  // Handlers are optional — when omitted the modifier click silently no-ops.
  onOpenPanel?: (ref: ObjectMapReference) => void;
  onNavigateView?: (ref: ObjectMapReference) => void;
  onOpenObjectMap?: (ref: ObjectMapReference) => void;
}

const ObjectMap: React.FC<ObjectMapProps> = ({
  payload: wirePayload,
  onRefresh,
  isRefreshing = false,
  onOpenPanel,
  onNavigateView,
  onOpenObjectMap,
}) => {
  const elementIdPrefix = useId();
  const payload = useMemo(() => normalizeObjectMapPayload(wirePayload), [wirePayload]);
  const modelTimingStartedAt = objectMapTimingNow();
  const model = useObjectMapModel(payload);
  const modelTimingMs = objectMapTimingNow() - modelTimingStartedAt;
  const useShortResourceNames = useShortNames();
  const [showLegend, setShowLegend] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<string> | null>(null);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<ObjectMapMenuState | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const debugMapIdRef = useRef(createObjectMapDebugId());
  const isMapDebugOverlayVisible = useObjectMapDebugOverlayVisible();
  const { legendPosition, legendPointerHandlers } = useObjectMapLegendDrag(canvasRef);
  const [g6ViewportControls, setG6ViewportControls] = useState<ObjectMapViewportControls | null>(
    null
  );

  const visibleStateResult = useMemo(() => {
    const startedAt = objectMapTimingNow();
    const state = deriveObjectMapVisibleState({
      layout: model.layout,
      seedNodeId: model.seedId,
      activeNodeId: model.activeNodeId,
      focusMode,
      selectedKinds,
      enabledEdgeTypes,
      searchQuery,
      useShortResourceNames,
    });
    return { state, durationMs: objectMapTimingNow() - startedAt };
  }, [
    enabledEdgeTypes,
    focusMode,
    model.activeNodeId,
    model.layout,
    model.seedId,
    searchQuery,
    selectedKinds,
    useShortResourceNames,
  ]);
  const visibleState = visibleStateResult.state;

  useEffect(() => {
    setEnabledEdgeTypes((previous) => {
      return pruneObjectMapEnabledEdgeTypes(previous, visibleState.visibleEdgeTypes);
    });
  }, [visibleState.visibleEdgeTypes]);

  const isEdgeTypeEnabled = useCallback(
    (type: string) => !enabledEdgeTypes || enabledEdgeTypes.has(type),
    [enabledEdgeTypes]
  );

  useEffect(() => {
    setSelectedKinds((previous) => {
      return pruneObjectMapSelectedKinds(previous, visibleState.kindOptions);
    });
  }, [visibleState.kindOptions]);

  const toggleEdgeType = useCallback(
    (type: string) => {
      setEnabledEdgeTypes((previous) => {
        const next = new Set(previous ?? Array.from(visibleState.visibleEdgeTypes));
        if (next.has(type)) {
          next.delete(type);
        } else {
          next.add(type);
        }
        return next.size === visibleState.visibleEdgeTypes.size ? null : next;
      });
    },
    [visibleState.visibleEdgeTypes]
  );
  const showAllEdgeTypes = useCallback(() => {
    setEnabledEdgeTypes(null);
  }, []);
  const hideAllEdgeTypes = useCallback(() => {
    setEnabledEdgeTypes(new Set());
  }, []);
  const enabledLegendEntryCount = visibleState.legendEntries.filter((entry) =>
    isEdgeTypeEnabled(entry.type)
  ).length;
  const legendGroups = useMemo<ObjectMapLegendGroup[]>(() => {
    const groups = new Map<EdgeKindMeta['family'], ObjectMapLegendGroup>();
    visibleState.legendEntries.forEach((entry) => {
      const group =
        groups.get(entry.family) ??
        ({
          family: entry.family,
          label: OBJECT_MAP_EDGE_FAMILY_LABELS[entry.family],
          entries: [],
        } satisfies ObjectMapLegendGroup);
      group.entries.push(entry);
      groups.set(entry.family, group);
    });
    return Array.from(groups.values());
  }, [visibleState.legendEntries]);

  useEffect(() => {
    void visibleState.normalizedSearchQuery;
    setSearchIndex(0);
  }, [visibleState.normalizedSearchQuery]);

  const focusSearchMatch = useCallback(() => {
    if (visibleState.searchMatches.length === 0) {
      return;
    }
    const nextIndex = Math.min(searchIndex, visibleState.searchMatches.length - 1);
    const node = visibleState.searchMatches[nextIndex];
    setSearchIndex((prev) => (prev + 1) % visibleState.searchMatches.length);
    model.focusNode(node.id);
    g6ViewportControls?.focusNode(node.id);
  }, [g6ViewportControls, model, searchIndex, visibleState.searchMatches]);

  const handleKindsChange = useCallback((value: string | string[]) => {
    setSelectedKinds(Array.isArray(value) ? value : value ? [value] : []);
  }, []);

  const renderFilterOption = useCallback(
    (option: DropdownOption, isSelected: boolean) => (
      <span className="dropdown-filter-option">
        <span className="dropdown-filter-check">{isSelected ? '✓' : ''}</span>
        <span className="dropdown-filter-label">{option.label}</span>
      </span>
    ),
    []
  );

  const renderKindsValue = useCallback((value: string | string[], _options: DropdownOption[]) => {
    const count = Array.isArray(value) ? value.length : value ? 1 : 0;
    return count > 0 ? `Kinds (${count})` : 'Kinds';
  }, []);

  const disableAutoFitForManualViewport = useCallback(() => {
    model.setAutoFit(false);
  }, [model]);

  const resetMapLayout = useCallback(() => {
    model.resetLayout();
    setFocusMode(false);
  }, [model]);
  const refreshLabel = isRefreshing ? 'Refreshing' : 'Refresh';

  const viewportControlsReady = Boolean(g6ViewportControls);
  const visibleNodeIds = useMemo(
    () => new Set(visibleState.visibleLayout.nodes.map((node) => node.id)),
    [visibleState.visibleLayout.nodes]
  );
  const selectedViewportNodeId =
    model.activeNodeId && visibleNodeIds.has(model.activeNodeId) ? model.activeNodeId : null;
  const seedViewportNodeId = visibleNodeIds.has(model.seedId) ? model.seedId : null;
  const fallbackViewportNodeId = visibleState.visibleLayout.nodes[0]?.id ?? null;
  const preserveViewportNodeId =
    model.autoFit || focusMode
      ? null
      : (selectedViewportNodeId ?? seedViewportNodeId ?? fallbackViewportNodeId);

  useEffect(() => {
    const debugId = debugMapIdRef.current;
    return () => removeObjectMapDebugSnapshot(debugId);
  }, []);

  useEffect(() => {
    const debugId = debugMapIdRef.current;
    publishObjectMapDebugSnapshot({
      id: debugId,
      clusterId: payload.clusterId,
      clusterName: payload.clusterName,
      seedRef: payload.seed,
      seedNodeId: model.seedId,
      activeNodeId: model.activeNodeId,
      focusMode,
      autoFit: model.autoFit,
      selectedKinds,
      enabledEdgeTypes: enabledEdgeTypes ? Array.from(enabledEdgeTypes).sort() : null,
      preserveViewportNodeId,
      payload: {
        nodes: payload.nodes.length,
        edges: payload.edges.length,
        maxDepth: payload.maxDepth,
        maxNodes: payload.maxNodes,
        truncated: payload.truncated,
        warnings: payload.warnings?.length ?? 0,
      },
      layout: {
        nodes: model.layout.nodes.length,
        edges: model.layout.edges.length,
        bounds: model.layout.bounds,
      },
      visibleLayout: {
        nodes: visibleState.visibleLayout.nodes.length,
        edges: visibleState.visibleLayout.edges.length,
        bounds: visibleState.visibleLayout.bounds,
      },
      search: {
        query: searchQuery,
        matches: visibleState.searchMatches.length,
      },
      timings: {
        modelMs: modelTimingMs,
        visibleStateMs: visibleStateResult.durationMs,
      },
      renderer: null,
      updatedAt: Date.now(),
    });
  }, [
    enabledEdgeTypes,
    focusMode,
    model.activeNodeId,
    model.autoFit,
    model.layout.bounds,
    model.layout.edges.length,
    model.layout.nodes.length,
    model.seedId,
    modelTimingMs,
    payload,
    preserveViewportNodeId,
    searchQuery,
    selectedKinds,
    visibleStateResult.durationMs,
    visibleState.searchMatches.length,
    visibleState.visibleLayout.bounds,
    visibleState.visibleLayout.edges.length,
    visibleState.visibleLayout.nodes.length,
  ]);

  const nodeByReference = useMemo(
    () => new Map(payload.nodes.map((node) => [objectMapReferenceKey(node.ref), node])),
    [payload.nodes]
  );
  const contextMenuObject = useMemo<ObjectActionData | null>(() => {
    if (contextMenu?.type !== 'object') {
      return null;
    }
    const ref = contextMenu.request.ref;
    const node = nodeByReference.get(objectMapReferenceKey(ref));
    const actionFacts = node?.actionFacts;
    return {
      ...ref,
      status: actionFacts?.status,
      unschedulable: actionFacts?.unschedulable,
      portForwardAvailable: actionFacts?.portForwardAvailable,
      hpaManaged:
        actionFacts?.hpaManaged === true ? true : actionFacts?.hpaManaged === false ? false : null,
      desiredReplicas: actionFacts?.desiredReplicas,
    };
  }, [contextMenu, nodeByReference]);
  const objectActions = useObjectActionController({
    context: 'object-map',
    onOpen: onOpenPanel ? (object) => onOpenPanel(object as ObjectMapReference) : undefined,
    onOpenObjectMap: onOpenObjectMap
      ? (object) => onOpenObjectMap(object as ObjectMapReference)
      : undefined,
    onNavigateView: onNavigateView
      ? (object) => onNavigateView(object as ObjectMapReference)
      : undefined,
  });
  const canvasContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [
      {
        label: 'Zoom out',
        icon: <ZoomOutIcon />,
        onClick: g6ViewportControls?.zoomOut,
        disabled: !viewportControlsReady,
      },
      {
        label: 'Zoom in',
        icon: <ZoomInIcon />,
        onClick: g6ViewportControls?.zoomIn,
        disabled: !viewportControlsReady,
      },
      {
        label: 'Reset zoom',
        icon: <ResetZoomIcon />,
        onClick: g6ViewportControls?.resetZoom,
        disabled: !viewportControlsReady,
      },
      { divider: true },
      {
        label: 'Fit',
        icon: <FitToViewIcon />,
        onClick: g6ViewportControls?.fitToView,
        disabled: !viewportControlsReady,
      },
      {
        label: model.autoFit ? 'Auto-fit off' : 'Auto-fit on',
        icon: <AutoFitIcon />,
        onClick: () => model.setAutoFit((prev) => !prev),
      },
      { divider: true },
      {
        label: focusMode ? 'Focus off' : 'Focus on',
        icon: <FocusModeIcon />,
        onClick: () => setFocusMode((prev) => !prev),
      },
      {
        label: 'Reset layout',
        icon: <ResetFiltersIcon />,
        onClick: resetMapLayout,
        disabled: !model.hasNodePositionOverrides && !focusMode,
      },
      { divider: true },
    ];
    if (onRefresh) {
      items.push({
        label: refreshLabel,
        icon: <RefreshIcon />,
        onClick: onRefresh,
        disabled: isRefreshing,
      });
      items.push({ divider: true });
    }
    items.push({
      label: showLegend ? 'Hide legend' : 'Show legend',
      icon: <LegendIcon />,
      onClick: () => setShowLegend((prev) => !prev),
    });
    return items;
  }, [
    focusMode,
    g6ViewportControls,
    isRefreshing,
    model,
    onRefresh,
    refreshLabel,
    resetMapLayout,
    showLegend,
    viewportControlsReady,
  ]);
  const contextMenuItems = useMemo(() => {
    if (!contextMenu) {
      return [];
    }
    return contextMenu.type === 'object'
      ? objectActions.getMenuItems(contextMenuObject)
      : canvasContextMenuItems;
  }, [canvasContextMenuItems, contextMenu, contextMenuObject, objectActions]);
  const contextMenuPosition =
    contextMenu?.type === 'object' ? contextMenu.request.position : contextMenu?.position;
  const handleNodeContextMenu = useCallback((request: ObjectMapContextMenuRequest) => {
    setContextMenu({ type: 'object', request });
  }, []);
  const handleCanvasContextMenu = useCallback((request: { position: { x: number; y: number } }) => {
    setContextMenu({ type: 'canvas', position: request.position });
  }, []);
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const toolbar = (
    <div
      className="object-map__toolbar"
      role="toolbar"
      aria-label="Object map controls"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <form
        className="object-map__search"
        aria-label="Search object map"
        onSubmit={(event) => {
          event.preventDefault();
          focusSearchMatch();
        }}
      >
        <div className="object-map__kind-filter" data-gridtable-filter-role="kind">
          <Dropdown
            id={`${elementIdPrefix}-object-map-kind-filter`}
            name="object-map-kind-filter"
            multiple
            size="compact"
            searchable
            showBulkActions
            placeholder="All kinds"
            value={selectedKinds}
            options={visibleState.kindOptions}
            disabled={visibleState.kindOptions.length === 0}
            onChange={handleKindsChange}
            dropdownClassName="dropdown-filter-menu"
            ariaLabel="Filter map kinds"
            renderOption={renderFilterOption}
            renderValue={renderKindsValue}
          />
        </div>
        <input
          type="search"
          className="object-map__search-input"
          aria-label="Search map objects"
          placeholder="Search objects"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        {!!visibleState.normalizedSearchQuery && (
          <span className="object-map__search-count">
            {visibleState.searchMatches.length === 0
              ? '0/0'
              : `${Math.min(searchIndex + 1, visibleState.searchMatches.length)}/${
                  visibleState.searchMatches.length
                }`}
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
        <ZoomOutIcon width={18} height={18} />
      </button>
      <button
        type="button"
        className="object-map__toolbar-button"
        onClick={g6ViewportControls?.zoomIn}
        title="Zoom in"
        aria-label="Zoom in"
        disabled={!viewportControlsReady}
      >
        <ZoomInIcon width={18} height={18} />
      </button>
      <button
        type="button"
        className="object-map__toolbar-button"
        onClick={g6ViewportControls?.resetZoom}
        title="Reset zoom to 100%"
        aria-label="Reset zoom"
        disabled={!viewportControlsReady}
      >
        <ResetZoomIcon />
      </button>
      <span className="object-map__toolbar-separator" aria-hidden="true" />
      <button
        type="button"
        className="object-map__toolbar-button"
        onClick={g6ViewportControls?.fitToView}
        title="Fit visible objects into the viewport"
        aria-label="Fit"
        disabled={!viewportControlsReady}
      >
        <FitToViewIcon width={18} height={18} />
      </button>
      <button
        type="button"
        className={`object-map__toolbar-button ${
          model.autoFit ? 'object-map__toolbar-button--active' : ''
        }`}
        onClick={() => model.setAutoFit((prev) => !prev)}
        title={
          model.autoFit
            ? 'Auto-fit on - automatically fits visible objects into the viewport'
            : 'Auto-fit off - pan and zoom changes are retained'
        }
        aria-label="Toggle auto-fit"
        aria-pressed={model.autoFit}
      >
        <AutoFitIcon width={18} height={18} />
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
        <FocusModeIcon width={18} height={18} />
      </button>
      <button
        type="button"
        className="object-map__toolbar-button"
        onClick={resetMapLayout}
        title="Reset layout"
        aria-label="Reset layout"
        disabled={!model.hasNodePositionOverrides && !focusMode}
      >
        <ResetFiltersIcon width={18} height={18} />
      </button>
      <span className="object-map__toolbar-separator" aria-hidden="true" />
      {!!onRefresh && (
        <button
          type="button"
          className={`object-map__toolbar-button ${
            isRefreshing ? 'object-map__toolbar-button--refreshing' : ''
          }`}
          onClick={onRefresh}
          title={refreshLabel}
          aria-label={refreshLabel}
          aria-busy={isRefreshing}
          disabled={isRefreshing}
        >
          <RefreshIcon width={18} height={18} />
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
        <LegendIcon width={18} height={18} />
      </button>
    </div>
  );

  if (model.layout.nodes.length === 0) {
    return (
      <div className="object-map object-map--empty" data-testid="object-map-empty">
        <p>No related objects found.</p>
      </div>
    );
  }

  return (
    <div className="object-map" data-testid="object-map">
      <div className="object-map__header">{toolbar}</div>
      <div ref={canvasRef} className="object-map__canvas">
        <React.Suspense fallback={<div className="object-map__message">Loading map renderer…</div>}>
          <ObjectMapG6Renderer
            layout={visibleState.visibleLayout}
            selectionState={visibleState.visibleSelectionState}
            useShortResourceNames={useShortResourceNames}
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
            onOpenObjectMap={onOpenObjectMap}
            onNavigateView={onNavigateView}
            onNodeContextMenu={handleNodeContextMenu}
            onCanvasContextMenu={handleCanvasContextMenu}
            autoFit={model.autoFit}
            preserveViewportNodeId={preserveViewportNodeId}
            debugMapId={debugMapIdRef.current}
            showDebugGrid={isMapDebugOverlayVisible}
            onUserViewportChange={disableAutoFitForManualViewport}
            onViewportControlsChange={setG6ViewportControls}
          />
        </React.Suspense>
        {!!showLegend && (
          <section
            className="object-map__legend"
            aria-label="Object map legend"
            style={
              legendPosition
                ? { left: legendPosition.left, right: 'auto', top: legendPosition.top }
                : undefined
            }
            {...legendPointerHandlers}
          >
            <Tooltip
              content="Close the legend. You can open it again with the Legend button on the toolbar."
              placement="bottom"
              hoverDelay={500}
              showArrow={false}
            >
              <button
                type="button"
                className="object-map__legend-close"
                aria-label="Close legend"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowLegend(false);
                }}
              >
                <CloseIcon width={10} height={10} />
              </button>
            </Tooltip>
            {legendGroups.map((group) => (
              <div key={group.family} className="object-map__legend-group">
                <div className="object-map__legend-category">{group.label}</div>
                {group.entries.map((entry) => (
                  <button
                    key={entry.type}
                    type="button"
                    className={`object-map__legend-row ${
                      isEdgeTypeEnabled(entry.type) ? '' : 'object-map__legend-row--disabled'
                    }`}
                    onClick={() => toggleEdgeType(entry.type)}
                    aria-pressed={isEdgeTypeEnabled(entry.type)}
                  >
                    <ObjectMapLegendSwatchIcon edgeClassName={objectMapEdgeClass(entry.type)} />
                    <span className="object-map__legend-label">{entry.label}</span>
                  </button>
                ))}
              </div>
            ))}
            {visibleState.legendEntries.length > 0 && (
              <div className="object-map__legend-actions">
                <button
                  type="button"
                  className="object-map__legend-action-button"
                  onClick={showAllEdgeTypes}
                  disabled={enabledLegendEntryCount === visibleState.legendEntries.length}
                >
                  Show all
                </button>
                <button
                  type="button"
                  className="object-map__legend-action-button"
                  onClick={hideAllEdgeTypes}
                  disabled={enabledLegendEntryCount === 0}
                >
                  Hide all
                </button>
              </div>
            )}
            <div className="object-map__legend-separator" aria-hidden="true" />
            <div
              className="object-map__legend-counts"
              role="status"
              aria-label="Visible map totals"
            >
              <span className="object-map__legend-count">
                <span className="object-map__legend-count-value">
                  {visibleState.visibleLayout.nodes.length}
                </span>
                <span className="object-map__legend-count-label">Objects</span>
              </span>
              <span className="object-map__legend-count">
                <span className="object-map__legend-count-value">
                  {visibleState.visibleLayout.edges.length}
                </span>
                <span className="object-map__legend-count-label">Links</span>
              </span>
            </div>
          </section>
        )}
      </div>
      {contextMenu && contextMenuPosition && contextMenuItems.length > 0 && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenuPosition}
          onClose={closeContextMenu}
        />
      )}
      {objectActions.modals}
      {!!payload.truncated && (
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
            {withStableListKeys(payload.warnings, (warning) => warning).map(
              ({ key, value: warning }) => (
                <li key={key}>{warning}</li>
              )
            )}
          </ul>
        </details>
      )}
    </div>
  );
};

export default ObjectMap;
