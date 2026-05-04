/**
 * frontend/src/modules/object-map/ObjectMap.tsx
 *
 * Shell for the object-map snapshot view. Data preparation and interaction
 * state live in `useObjectMapModel`; drawing is delegated to the lazy-loaded
 * G6 renderer so the heavy graph dependency stays out of the initial bundle.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ObjectMap.css';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@core/refresh/types';
import { useShortNames } from '@/hooks/useShortNames';
import { isMacPlatform } from '@/utils/platform';
import ContextMenu from '@shared/components/ContextMenu';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { objectMapEdgeClass } from './objectMapEdgeStyle';
import type { ObjectMapContextMenuRequest } from './objectMapRendererTypes';
import type { ObjectMapViewportControls } from './objectMapRendererTypes';
import { useObjectMapModel } from './useObjectMapModel';
import {
  deriveObjectMapVisibleState,
  pruneObjectMapEnabledEdgeTypes,
  pruneObjectMapSelectedKinds,
} from './objectMapVisibleState';
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

type LegendPosition = {
  left: number;
  top: number;
};

type LegendDragState = {
  pointerId: number;
  originClientX: number;
  originClientY: number;
  originLeft: number;
  originTop: number;
};

const LEGEND_CANVAS_PADDING_PX = 8;

const isInteractiveLegendTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(target.closest('button, input, select, textarea, a, [role="button"]'));

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
  const useShortResourceNames = useShortNames();
  const [showLegend, setShowLegend] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<string> | null>(null);
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<ObjectMapContextMenuRequest | null>(null);
  const [legendPosition, setLegendPosition] = useState<LegendPosition | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const legendDragRef = useRef<LegendDragState | null>(null);
  const [g6ViewportControls, setG6ViewportControls] = useState<ObjectMapViewportControls | null>(
    null
  );
  const primaryModifierLabel = useMemo(() => (isMacPlatform() ? 'cmd' : 'ctrl'), []);

  const visibleState = useMemo(
    () =>
      deriveObjectMapVisibleState({
        layout: model.layout,
        activeNodeId: model.activeNodeId,
        focusMode,
        selectedKinds,
        enabledEdgeTypes,
        searchQuery,
        useShortResourceNames,
      }),
    [
      enabledEdgeTypes,
      focusMode,
      model.activeNodeId,
      model.layout,
      searchQuery,
      selectedKinds,
      useShortResourceNames,
    ]
  );

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

  useEffect(() => {
    setSearchIndex(0);
  }, [visibleState.normalizedSearchQuery]);

  const focusSearchMatch = useCallback(() => {
    if (visibleState.searchMatches.length === 0) return;
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
  const clampLegendPosition = useCallback((left: number, top: number, legend: HTMLElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return { left, top };

    const canvasRect = canvas.getBoundingClientRect();
    const legendRect = legend.getBoundingClientRect();
    const maxLeft = Math.max(
      LEGEND_CANVAS_PADDING_PX,
      canvasRect.width - legendRect.width - LEGEND_CANVAS_PADDING_PX
    );
    const maxTop = Math.max(
      LEGEND_CANVAS_PADDING_PX,
      canvasRect.height - legendRect.height - LEGEND_CANVAS_PADDING_PX
    );

    return {
      left: Math.min(Math.max(LEGEND_CANVAS_PADDING_PX, left), maxLeft),
      top: Math.min(Math.max(LEGEND_CANVAS_PADDING_PX, top), maxTop),
    };
  }, []);
  const handleLegendPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.stopPropagation();
      if (event.button !== 0 || isInteractiveLegendTarget(event.target)) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const legend = event.currentTarget;
      const canvasRect = canvas.getBoundingClientRect();
      const legendRect = legend.getBoundingClientRect();
      const start = clampLegendPosition(
        legendRect.left - canvasRect.left,
        legendRect.top - canvasRect.top,
        legend
      );

      legendDragRef.current = {
        pointerId: event.pointerId,
        originClientX: event.clientX,
        originClientY: event.clientY,
        originLeft: start.left,
        originTop: start.top,
      };
      setLegendPosition(start);
      if (typeof legend.setPointerCapture === 'function') {
        legend.setPointerCapture(event.pointerId);
      }
    },
    [clampLegendPosition]
  );
  const handleLegendPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = legendDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      event.stopPropagation();
      const next = clampLegendPosition(
        drag.originLeft + event.clientX - drag.originClientX,
        drag.originTop + event.clientY - drag.originClientY,
        event.currentTarget
      );
      setLegendPosition(next);
    },
    [clampLegendPosition]
  );
  const handleLegendPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = legendDragRef.current;
    event.stopPropagation();
    if (!drag || drag.pointerId !== event.pointerId) return;

    legendDragRef.current = null;
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const toolbar = (
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
        <div className="object-map__kind-filter" data-gridtable-filter-role="kind">
          <Dropdown
            id="object-map-kind-filter"
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
        {visibleState.normalizedSearchQuery && (
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
      <button
        type="button"
        className="object-map__toolbar-button"
        onClick={g6ViewportControls?.fitToView}
        title="Fit visible objects into the viewport"
        aria-label="Fit"
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
            ? 'Auto-fit on - automatically fits visible objects into the viewport'
            : 'Auto-fit off - pan and zoom changes are retained'
        }
        aria-label="Toggle auto-fit"
        aria-pressed={model.autoFit}
      >
        <AutoFitIcon />
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
      <button
        type="button"
        className="object-map__toolbar-button"
        onClick={resetMapLayout}
        title="Reset layout"
        aria-label="Reset layout"
        disabled={!model.hasNodePositionOverrides && !focusMode}
      >
        <ResetFiltersIcon />
      </button>
      <span className="object-map__toolbar-separator" aria-hidden="true" />
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
        <Suspense fallback={<div className="object-map__message">Loading map renderer…</div>}>
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
            onNavigateView={onNavigateView}
            onNodeContextMenu={handleNodeContextMenu}
            autoFit={model.autoFit}
            preserveViewportNodeId={!model.autoFit && focusMode ? model.activeNodeId : null}
            onUserViewportChange={disableAutoFitForManualViewport}
            onViewportControlsChange={setG6ViewportControls}
          />
        </Suspense>
        {showLegend && (
          <div
            className="object-map__legend"
            role="region"
            aria-label="Object map legend"
            style={
              legendPosition
                ? { left: legendPosition.left, right: 'auto', top: legendPosition.top }
                : undefined
            }
            onPointerDown={handleLegendPointerDown}
            onPointerMove={handleLegendPointerMove}
            onPointerUp={handleLegendPointerEnd}
            onPointerCancel={handleLegendPointerEnd}
            onClick={(e) => e.stopPropagation()}
          >
            {visibleState.legendEntries.map((entry) => (
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
            {visibleState.legendEntries.length > 0 && (
              <>
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
                <div className="object-map__legend-separator" aria-hidden="true" />
              </>
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
