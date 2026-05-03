/**
 * frontend/src/modules/object-map/ObjectMap.tsx
 *
 * Shell for the object-map snapshot view. Data preparation and interaction
 * state live in `useObjectMapModel`; drawing is delegated to a renderer. The
 * object-panel map tab uses the G6 renderer for production performance, while
 * the SVG renderer remains available as a fallback and comparison target.
 */

import React, { Suspense, useCallback, useMemo, useState } from 'react';
import './ObjectMap.css';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@core/refresh/types';
import ObjectMapSvgRenderer from './ObjectMapSvgRenderer';
import { objectMapEdgeClass, OBJECT_MAP_EDGE_KINDS } from './objectMapEdgeStyle';
import type { ObjectMapViewportControls } from './objectMapRendererTypes';
import { useObjectMapModel } from './useObjectMapModel';
import {
  AutoFitIcon,
  FitToViewIcon,
  LegendIcon,
  RefreshIcon,
  ResetFiltersIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@shared/components/icons/MenuIcons';

const ObjectMapG6Renderer = React.lazy(() => import('./ObjectMapG6Renderer'));

export interface ObjectMapProps {
  payload: ObjectMapSnapshotPayload;
  // Renderer switch kept for fallback/testing. The object-panel map tab
  // explicitly requests G6; SVG remains useful for comparison stories and
  // renderer-independent behavior tests.
  rendererKind?: 'svg' | 'g6';
  // Forces a refit when bumped — wire to a host's "Reset view" trigger.
  resetToken?: number;
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
}

const ObjectMap: React.FC<ObjectMapProps> = ({
  payload,
  rendererKind = 'svg',
  resetToken = 0,
  onRefresh,
  isRefreshing = false,
  onOpenPanel,
  onNavigateView,
}) => {
  const model = useObjectMapModel(payload, { resetToken });
  const [showLegend, setShowLegend] = useState(true);
  const [g6ViewportControls, setG6ViewportControls] = useState<ObjectMapViewportControls | null>(
    null
  );
  const isG6Renderer = rendererKind === 'g6';

  const visibleEdgeTypes = useMemo(() => {
    const types = new Set<string>();
    model.layout.edges.forEach((edge) => types.add(edge.type.trim().toLowerCase()));
    return types;
  }, [model.layout.edges]);

  const legendEntries = useMemo(
    () => OBJECT_MAP_EDGE_KINDS.filter((entry) => visibleEdgeTypes.has(entry.type)),
    [visibleEdgeTypes]
  );

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      if (model.panZoom.wasDrag()) return;
      const target = event.target as Element | null;
      if (target && target.closest('g.object-map-node')) {
        return;
      }
      model.clearSelection();
    },
    [model]
  );

  const zoomOut = isG6Renderer ? g6ViewportControls?.zoomOut : model.panZoom.zoomOut;
  const zoomIn = isG6Renderer ? g6ViewportControls?.zoomIn : model.panZoom.zoomIn;
  const fitToView = isG6Renderer ? g6ViewportControls?.fitToView : model.panZoom.resetView;
  const viewportControlsReady = !isG6Renderer || Boolean(g6ViewportControls);

  if (model.layout.nodes.length === 0) {
    return (
      <div className="object-map object-map--empty" data-testid="object-map-empty">
        <p>No related objects found.</p>
      </div>
    );
  }

  return (
    <div className="object-map" data-testid="object-map">
      <div
        ref={model.panZoom.containerRef}
        className={`object-map__canvas ${
          !isG6Renderer && model.panZoom.isPanning ? 'object-map__canvas--panning' : ''
        }`}
        onWheel={isG6Renderer ? undefined : model.panZoom.onWheel}
        onPointerDown={isG6Renderer ? undefined : model.panZoom.onPointerDown}
        onPointerMove={isG6Renderer ? undefined : model.panZoom.onPointerMove}
        onPointerUp={isG6Renderer ? undefined : model.panZoom.onPointerUp}
        onPointerCancel={isG6Renderer ? undefined : model.panZoom.onPointerUp}
        onClick={isG6Renderer ? undefined : handleCanvasClick}
      >
        {rendererKind === 'g6' ? (
          <Suspense fallback={<div className="object-map__message">Loading map renderer…</div>}>
            <ObjectMapG6Renderer
              layout={model.layout}
              selectionState={model.selectionState}
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
              autoFit={model.autoFit}
              onViewportControlsChange={setG6ViewportControls}
            />
          </Suspense>
        ) : (
          <ObjectMapSvgRenderer
            layout={model.layout}
            viewport={model.panZoom.viewport}
            selectionState={model.selectionState}
            hoverEdge={model.hoverEdge}
            onHoverEdge={model.setHoverEdge}
            onClearHoverEdge={model.clearHoverEdge}
            badgeForNode={model.badgeForNode}
            onSelectNode={model.selectNode}
            onToggleGroup={model.toggleGroup}
            onNodeDragStart={model.startNodeDrag}
            onNodeDragMove={model.moveNodeDrag}
            onNodeDragEnd={model.endNodeDrag}
            onOpenPanel={onOpenPanel}
            onNavigateView={onNavigateView}
          />
        )}
        <div
          className="object-map__toolbar"
          role="toolbar"
          aria-label="Object map controls"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="object-map__toolbar-button"
            onClick={zoomOut}
            title="Zoom out"
            aria-label="Zoom out"
            disabled={!viewportControlsReady}
          >
            <ZoomOutIcon />
          </button>
          <button
            type="button"
            className="object-map__toolbar-button"
            onClick={zoomIn}
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
            onClick={fitToView}
            title={
              model.autoFit
                ? 'Fit to view (auto-fit is on; turn it off to use this manually)'
                : 'Fit to view'
            }
            aria-label="Fit to view"
            disabled={model.autoFit || !viewportControlsReady}
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
        {showLegend && legendEntries.length > 0 && (
          <div className="object-map__legend" role="region" aria-label="Edge color legend">
            {legendEntries.map((entry) => (
              <div key={entry.type} className="object-map__legend-row">
                <svg className="object-map__legend-swatch" width={26} height={6} aria-hidden="true">
                  <line x1={0} y1={3} x2={26} y2={3} className={objectMapEdgeClass(entry.type)} />
                </svg>
                <span className="object-map__legend-label">{entry.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
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
