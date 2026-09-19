import {
  type ObjectMapDebugSnapshot,
  setObjectMapDebugOverlayVisible,
  useObjectMapDebugSnapshots,
} from '@modules/object-map/objectMapDebugStore';
import { CopyIcon } from '@shared/components/icons/LogIcons';
import { getAllPanelStates, useDockablePanelContext } from '@ui/dockable';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DebugOverlay } from './DebugOverlay';
import { IconDebugOverlay } from './IconDebugOverlay';
import { useAppDebugShortcuts } from './useAppDebugShortcuts';

export const AppDebugOverlays = () => {
  const [isFocusOverlayVisible, setIsFocusOverlayVisible] = useState(false);
  const [isErrorOverlayVisible, setIsErrorOverlayVisible] = useState(false);
  const [isPanelDebugOverlayVisible, setIsPanelDebugOverlayVisible] = useState(false);
  const [isMapDebugOverlayVisible, setIsMapDebugOverlayVisible] = useState(false);
  const [isIconDebugOverlayVisible, setIsIconDebugOverlayVisible] = useState(false);

  useAppDebugShortcuts({
    onTogglePanelDebug: () => setIsPanelDebugOverlayVisible((prev) => !prev),
    onToggleFocusDebug: () => setIsFocusOverlayVisible((prev) => !prev),
    onToggleErrorDebug: () => setIsErrorOverlayVisible((prev) => !prev),
    onToggleMapDebug: () => setIsMapDebugOverlayVisible((prev) => !prev),
    onToggleIconDebug: () => setIsIconDebugOverlayVisible((prev) => !prev),
  });

  useEffect(() => {
    setObjectMapDebugOverlayVisible(isMapDebugOverlayVisible);
    return () => setObjectMapDebugOverlayVisible(false);
  }, [isMapDebugOverlayVisible]);

  return (
    <>
      {isPanelDebugOverlayVisible ? (
        <PanelDebugOverlay onClose={() => setIsPanelDebugOverlayVisible(false)} />
      ) : null}
      {isFocusOverlayVisible ? (
        <KeyboardFocusOverlay onClose={() => setIsFocusOverlayVisible(false)} />
      ) : null}
      {isErrorOverlayVisible ? (
        <ErrorBoundaryDebugOverlay onClose={() => setIsErrorOverlayVisible(false)} />
      ) : null}
      {isMapDebugOverlayVisible ? (
        <MapDebugOverlay onClose={() => setIsMapDebugOverlayVisible(false)} />
      ) : null}
      {isIconDebugOverlayVisible ? (
        <IconDebugOverlay onClose={() => setIsIconDebugOverlayVisible(false)} />
      ) : null}
    </>
  );
};

const DevTestErrorBoundaryLazy = React.lazy(() => import('@ui/errors/TestErrorBoundary'));

interface FocusDebugInfo {
  summary: string;
  tag: string;
  role: string | null;
  label: string | null;
  text: string | null;
  id: string | null;
  classes: string | null;
  tabIndex: number | null;
  disabled: boolean | null;
  focusArea: string | null;
  surface: string | null;
  path: string;
}

const formatDisabledState = (disabled: boolean | null): string => {
  if (disabled === null) {
    return 'n/a';
  }
  return disabled ? 'true' : 'false';
};

const focusInfoRows = (focusInfo: FocusDebugInfo) => [
  ['Summary', focusInfo.summary],
  ['Tag', focusInfo.tag],
  ['Role', focusInfo.role ?? 'none'],
  ['Label', focusInfo.label ?? 'none'],
  ['Text', focusInfo.text ?? 'none'],
  ['Id', focusInfo.id ?? 'none'],
  ['Classes', focusInfo.classes ?? 'none'],
  ['Tab Index', focusInfo.tabIndex !== null ? String(focusInfo.tabIndex) : 'none'],
  ['Disabled', formatDisabledState(focusInfo.disabled)],
  ['Focus Area', focusInfo.focusArea ?? 'none'],
  ['Surface', focusInfo.surface ?? 'none'],
  ['Path', focusInfo.path],
];

const getFocusableLabel = (element: HTMLElement) =>
  element.getAttribute('aria-label') ||
  element.getAttribute('aria-labelledby') ||
  (element instanceof HTMLInputElement && element.name ? `input[name="${element.name}"]` : null);

const describePathSegment = (element: HTMLElement) => {
  const tag = element.tagName.toLowerCase();
  const dataFocusArea = element.dataset.focusArea;
  if (dataFocusArea) {
    return `${tag}[data-focus-area="${dataFocusArea}"]`;
  }
  if (element.id) {
    return `${tag}#${element.id}`;
  }
  const classes = Array.from(element.classList).slice(0, 2);
  if (classes.length > 0) {
    return `${tag}.${classes.join('.')}`;
  }
  return tag;
};

const getSurfaceDescription = (element: HTMLElement) => {
  const modalSurface = element.closest<HTMLElement>('[data-modal-surface="true"]');
  if (modalSurface) {
    return 'modal';
  }

  const roles = ['dialog', 'navigation', 'tablist', 'listbox', 'menu'];
  for (const role of roles) {
    const match = element.closest<HTMLElement>(`[role="${role}"]`);
    if (match) {
      return role;
    }
  }

  const classMatches: Array<[selector: string, label: string]> = [
    ['.dropdown', 'dropdown'],
    ['.context-menu', 'context menu'],
    ['.object-panel', 'object panel'],
    ['.sidebar', 'sidebar'],
    ['.app-header', 'header'],
  ];
  for (const [selector, label] of classMatches) {
    if (element.closest(selector)) {
      return label;
    }
  }

  return null;
};

const getFocusArea = (element: HTMLElement) => {
  const direct = element.dataset.focusArea;
  if (direct) {
    return direct;
  }
  return element.closest<HTMLElement>('[data-focus-area]')?.dataset.focusArea ?? null;
};

const getFocusSummary = (
  element: HTMLElement,
  focusArea: string | null,
  label: string | null,
  text: string | null
) => {
  if (focusArea) {
    return focusArea;
  }
  if (label) {
    return label;
  }
  const tag = element.tagName.toLowerCase();
  if (element.id) {
    return `${tag}#${element.id}`;
  }
  if (text) {
    return `${tag} "${text}"`;
  }
  return tag;
};

const describeFocusTarget = (element: Element | null): FocusDebugInfo => {
  if (!(element instanceof HTMLElement)) {
    return {
      summary: 'No active element',
      tag: 'none',
      role: null,
      label: null,
      text: null,
      id: null,
      classes: null,
      tabIndex: null,
      disabled: null,
      focusArea: null,
      surface: null,
      path: 'none',
    };
  }

  const focusArea = getFocusArea(element);
  const label = getFocusableLabel(element);
  const text = element.textContent?.trim() || null;
  const summarizedText = text ? text.slice(0, 120) : null;
  const pathSegments: string[] = [];
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 4; depth += 1) {
    pathSegments.push(describePathSegment(current));
    current = current.parentElement;
  }

  return {
    summary: getFocusSummary(element, focusArea, label, summarizedText),
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    label,
    text: summarizedText,
    id: element.id || null,
    classes: element.className.trim() || null,
    tabIndex: element.tabIndex >= 0 ? element.tabIndex : null,
    disabled: 'disabled' in element ? Boolean((element as HTMLInputElement).disabled) : null,
    focusArea,
    surface: getSurfaceDescription(element),
    path: pathSegments.join(' <- '),
  };
};

interface OverlayCloseProps {
  // Each debug overlay is toggleable, so the shell gets a close callback.
  onClose: () => void;
}

const KeyboardFocusOverlay: React.FC<OverlayCloseProps> = ({ onClose }) => {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const overlayPointerInteractionRef = useRef(false);
  const [focusInfo, setFocusInfo] = useState<FocusDebugInfo>(() => describeFocusTarget(null));
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(
      focusInfoRows(focusInfo)
        .map(([label, value]) => `${label}: ${value}`)
        .join('\n')
    );
  }, [focusInfo]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const updateDescription = (event?: Event) => {
      const overlayElement = overlayRef.current;
      const activeElement = document.activeElement;
      const eventTarget = event?.target instanceof Node ? event.target : null;
      const activeElementIsDocumentFallback =
        activeElement === document.body || activeElement === document.documentElement;

      if (
        overlayElement &&
        ((activeElement instanceof Node && overlayElement.contains(activeElement)) ||
          (eventTarget && overlayElement.contains(eventTarget)) ||
          (activeElementIsDocumentFallback && overlayPointerInteractionRef.current))
      ) {
        return;
      }

      overlayPointerInteractionRef.current = false;
      setFocusInfo(describeFocusTarget(activeElement));
    };

    const handlePointerDown = (event: PointerEvent) => {
      const overlayElement = overlayRef.current;
      overlayPointerInteractionRef.current = Boolean(
        overlayElement?.contains(event.target as Node)
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      overlayPointerInteractionRef.current = false;
      updateDescription(event);
    };

    updateDescription();
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('focusin', updateDescription);
    window.addEventListener('focusout', updateDescription);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('focusin', updateDescription);
      window.removeEventListener('focusout', updateDescription);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <DebugOverlay
      title="Keyboard Focus (Ctrl+Alt+K)"
      testId="keyboard-focus-overlay"
      overlayRef={overlayRef}
      headerActions={
        <button
          type="button"
          className="debug-overlay__close"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => void handleCopy()}
          aria-label="Copy keyboard focus details"
          title="Copy keyboard focus details"
        >
          <CopyIcon width={18} height={18} />
        </button>
      }
      onClose={onClose}
    >
      {focusInfoRows(focusInfo).map(([label, value]) => (
        <div key={label} className="debug-overlay__section">
          <div className="debug-overlay__label">{label}</div>
          <div
            className="debug-overlay__value"
            title={label === 'Summary' || label === 'Path' ? value : undefined}
          >
            {value}
          </div>
        </div>
      ))}
    </DebugOverlay>
  );
};

const PanelDebugOverlay: React.FC<OverlayCloseProps> = ({ onClose }) => {
  const { tabGroups, panelRegistrations } = useDockablePanelContext();
  const [focusedPanelId, setFocusedPanelId] = useState<string | null>(null);

  useEffect(() => {
    const resolveFocusedPanelId = () => {
      const states = getAllPanelStates();
      let nextFocusedPanelId: string | null = null;
      let highestZIndex = Number.NEGATIVE_INFINITY;

      Object.entries(states).forEach(([panelId, state]) => {
        if (!state.isOpen) {
          return;
        }
        if (state.zIndex > highestZIndex) {
          highestZIndex = state.zIndex;
          nextFocusedPanelId = panelId;
        }
      });

      setFocusedPanelId((previous) =>
        previous === nextFocusedPanelId ? previous : nextFocusedPanelId
      );
    };

    const scheduleResolve = () => {
      window.setTimeout(resolveFocusedPanelId, 0);
    };

    resolveFocusedPanelId();
    window.addEventListener('focusin', scheduleResolve);
    window.addEventListener('keydown', scheduleResolve);
    document.addEventListener('mousedown', scheduleResolve, true);
    document.addEventListener('click', scheduleResolve, true);
    const intervalId = window.setInterval(resolveFocusedPanelId, 250);

    return () => {
      window.removeEventListener('focusin', scheduleResolve);
      window.removeEventListener('keydown', scheduleResolve);
      document.removeEventListener('mousedown', scheduleResolve, true);
      document.removeEventListener('click', scheduleResolve, true);
      window.clearInterval(intervalId);
    };
  }, []);

  const groups = [
    {
      id: 'right',
      tabs: tabGroups.right.tabs,
      activeTab: tabGroups.right.activeTab,
    },
    {
      id: 'bottom',
      tabs: tabGroups.bottom.tabs,
      activeTab: tabGroups.bottom.activeTab,
    },
    ...tabGroups.floating.map((group) => ({
      id: `floating:${group.groupId}`,
      tabs: group.tabs,
      activeTab: group.activeTab,
    })),
  ];

  const groupedPanelIds = groups.flatMap((group) => group.tabs);
  const assignedPanelIds = new Set(groupedPanelIds);
  const registeredPanels = Array.from(panelRegistrations.values()).sort((a, b) =>
    a.title.localeCompare(b.title)
  );
  const ungroupedRegisteredPanels = registeredPanels.filter(
    (registration) => !assignedPanelIds.has(registration.panelId)
  );
  const unregisteredGroupedPanelIds = groupedPanelIds.filter(
    (panelId) => !panelRegistrations.has(panelId)
  );

  return (
    <DebugOverlay title="Panel Debug (Ctrl+Alt+P)" testId="panel-debug-overlay" onClose={onClose}>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Hierarchy ({registeredPanels.length} registered)</div>
        <div className="panel-debug-tree">
          {groups.map((group) => (
            <div
              key={group.id}
              className={`panel-debug-tree__group${focusedPanelId && group.tabs.includes(focusedPanelId) ? ' panel-debug-tree__group--focused' : ''}`}
            >
              <div className="panel-debug-tree__group-header">
                <span className="panel-debug-tree__group-name">{group.id}</span>
                <span className="panel-debug-tree__group-count">{group.tabs.length}</span>
              </div>
              {group.tabs.length === 0 ? (
                <div className="panel-debug-tree__empty">No tabs</div>
              ) : (
                <ul className="panel-debug-tree__tabs">
                  {group.tabs.map((panelId) => {
                    const registration = panelRegistrations.get(panelId);
                    const tabTitle = registration?.title ?? panelId;
                    const isActive = panelId === group.activeTab;
                    return (
                      <li key={panelId} className="panel-debug-tree__tab-item">
                        <span className="panel-debug-tree__branch" aria-hidden="true">
                          └
                        </span>
                        <div className="panel-debug-tree__tab-content">
                          <div className="panel-debug-tree__tab-row">
                            <span
                              className={`panel-debug-tree__status-dot${isActive ? ' panel-debug-tree__status-dot--active' : ''}`}
                              aria-hidden="true"
                            />
                            <span className="panel-debug-tree__tab-title" title={tabTitle}>
                              {tabTitle}
                            </span>
                          </div>
                          <div className="panel-debug-tree__tab-id" title={panelId}>
                            {panelId}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="debug-overlay__section">
        <div className="debug-overlay__label">Integrity</div>
        <div className="panel-debug-tree__integrity-row">
          <span>unassigned registered</span>
          <strong>{ungroupedRegisteredPanels.length}</strong>
        </div>
        {ungroupedRegisteredPanels.length > 0 ? (
          <ul className="panel-debug-tree__ids">
            {ungroupedRegisteredPanels.map((panel) => (
              <li key={panel.panelId} title={panel.panelId}>
                {panel.panelId}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="panel-debug-tree__integrity-row">
          <span>unregistered grouped</span>
          <strong>{unregisteredGroupedPanelIds.length}</strong>
        </div>
        {unregisteredGroupedPanelIds.length > 0 ? (
          <ul className="panel-debug-tree__ids">
            {unregisteredGroupedPanelIds.map((panelId) => (
              <li key={panelId} title={panelId}>
                {panelId}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </DebugOverlay>
  );
};

const formatObjectMapDebugRef = (ref: ObjectMapDebugSnapshot['seedRef']): string => {
  const namespace = ref.namespace ? `${ref.namespace}/` : '';
  const api = `${ref.group || 'core'}/${ref.version}`;
  return `${ref.clusterId} ${api} ${ref.kind} ${namespace}${ref.name}`;
};

const formatObjectMapDebugBounds = (bounds: ObjectMapDebugSnapshot['layout']['bounds']): string =>
  `x ${Math.round(bounds.minX)}..${Math.round(bounds.maxX)}, y ${Math.round(bounds.minY)}..${Math.round(bounds.maxY)}`;

const formatObjectMapDebugVector = (value: [number, number]): string =>
  `${value[0].toFixed(1)}, ${value[1].toFixed(1)}`;

const formatObjectMapDebugMs = (value: number | null): string => {
  if (value === null) {
    return 'unknown';
  } else {
    return `${value.toFixed(value < 10 ? 2 : 1)} ms`;
  }
};

const formatDebugBoolean = (value: boolean) => (value ? 'true' : 'false');

const formatRendererCounts = (map: ObjectMapDebugSnapshot) => {
  if (!map.renderer) {
    return 'unknown';
  }
  return `${map.renderer.renderedNodeCount} objects / ${map.renderer.renderedEdgeCount} links`;
};

const formatSelectedKinds = (map: ObjectMapDebugSnapshot) =>
  map.selectedKinds.mode === 'some' ? map.selectedKinds.values.join(', ') : map.selectedKinds.mode;

const formatEnabledEdgeTypes = (map: ObjectMapDebugSnapshot) => {
  if (!map.enabledEdgeTypes) {
    return 'all';
  }
  return map.enabledEdgeTypes.join(', ') || 'none';
};

const formatMapSearch = (map: ObjectMapDebugSnapshot) =>
  map.search.query ? `"${map.search.query}" (${map.search.matches})` : 'none';

const ObjectMapViewportDebug = ({ map }: { map: ObjectMapDebugSnapshot }) => {
  if (!map.renderer?.viewport) {
    return <div className="debug-overlay__meta">No renderer viewport snapshot.</div>;
  }
  return (
    <dl className="map-debug-grid">
      <dt>ready</dt>
      <dd>{formatDebugBoolean(map.renderer.graphReady)}</dd>
      <dt>zoom</dt>
      <dd>{map.renderer.viewport.zoom.toFixed(3)}</dd>
      <dt>position</dt>
      <dd>{formatObjectMapDebugVector(map.renderer.viewport.position)}</dd>
      <dt>size</dt>
      <dd>{formatObjectMapDebugVector(map.renderer.viewport.size)}</dd>
      <dt>cards</dt>
      <dd>{map.renderer.cardDetailLevel}</dd>
      <dt>links</dt>
      <dd>{map.renderer.edgeDetailLevel}</dd>
    </dl>
  );
};

const ObjectMapTimingDebug = ({ map }: { map: ObjectMapDebugSnapshot }) => {
  const applyMode = map.renderer?.timings.graphDataApplyMode;
  return (
    <dl className="map-debug-grid">
      <dt>model</dt>
      <dd>{formatObjectMapDebugMs(map.timings.modelMs)}</dd>
      <dt>visible</dt>
      <dd>{formatObjectMapDebugMs(map.timings.visibleStateMs)}</dd>
      <dt>g6 data</dt>
      <dd>{formatObjectMapDebugMs(map.renderer?.timings.g6DataMs ?? null)}</dd>
      <dt>g6 apply</dt>
      <dd>
        {formatObjectMapDebugMs(map.renderer?.timings.graphDataApplyMs ?? null)}
        {applyMode ? ` (${applyMode})` : ''}
      </dd>
      <dt>selection</dt>
      <dd>{formatObjectMapDebugMs(map.renderer?.timings.selectionStateApplyMs ?? null)}</dd>
    </dl>
  );
};

const ObjectMapDebugEntry = ({ map }: { map: ObjectMapDebugSnapshot }) => (
  <div className="map-debug-entry">
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Map</div>
      <div className="debug-overlay__value">{map.id}</div>
      <div className="debug-overlay__meta">
        {map.clusterName ?? map.clusterId} - updated {new Date(map.updatedAt).toLocaleTimeString()}
      </div>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Seed</div>
      <div className="debug-overlay__value">{formatObjectMapDebugRef(map.seedRef)}</div>
      <div className="debug-overlay__meta">seed node: {map.seedNodeId || 'none'}</div>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">State</div>
      <dl className="map-debug-grid">
        <dt>auto-fit</dt>
        <dd>{map.autoFit ? 'on' : 'off'}</dd>
        <dt>focus</dt>
        <dd>{map.focusMode ? 'on' : 'off'}</dd>
        <dt>active</dt>
        <dd>{map.activeNodeId ?? 'none'}</dd>
        <dt>preserve</dt>
        <dd>{map.preserveViewportNodeId ?? 'none'}</dd>
      </dl>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Counts</div>
      <dl className="map-debug-grid">
        <dt>payload</dt>
        <dd>
          {map.payload.nodes} objects / {map.payload.edges} links
        </dd>
        <dt>layout</dt>
        <dd>
          {map.layout.nodes} objects / {map.layout.edges} links
        </dd>
        <dt>visible</dt>
        <dd>
          {map.visibleLayout.nodes} objects / {map.visibleLayout.edges} links
        </dd>
        <dt>rendered</dt>
        <dd>{formatRendererCounts(map)}</dd>
      </dl>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Viewport</div>
      <ObjectMapViewportDebug map={map} />
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Timings</div>
      <ObjectMapTimingDebug map={map} />
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Filters</div>
      <dl className="map-debug-grid">
        <dt>kinds</dt>
        <dd>{formatSelectedKinds(map)}</dd>
        <dt>links</dt>
        <dd>{formatEnabledEdgeTypes(map)}</dd>
        <dt>search</dt>
        <dd>{formatMapSearch(map)}</dd>
      </dl>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Bounds</div>
      <dl className="map-debug-grid">
        <dt>layout</dt>
        <dd>{formatObjectMapDebugBounds(map.layout.bounds)}</dd>
        <dt>visible</dt>
        <dd>{formatObjectMapDebugBounds(map.visibleLayout.bounds)}</dd>
      </dl>
    </div>
    <div className="debug-overlay__section">
      <div className="debug-overlay__label">Limits</div>
      <dl className="map-debug-grid">
        <dt>max depth</dt>
        <dd>{map.payload.maxDepth}</dd>
        <dt>max objects</dt>
        <dd>{map.payload.maxNodes}</dd>
        <dt>truncated</dt>
        <dd>{formatDebugBoolean(map.payload.truncated)}</dd>
        <dt>warnings</dt>
        <dd>{map.payload.warnings}</dd>
      </dl>
    </div>
  </div>
);

const ObjectMapDebugEntries = ({ maps }: { maps: ObjectMapDebugSnapshot[] }) => {
  if (maps.length === 0) {
    return <div className="debug-overlay__meta">No object maps are mounted.</div>;
  }
  return maps.map((map) => <ObjectMapDebugEntry key={map.id} map={map} />);
};

const MapDebugOverlay: React.FC<OverlayCloseProps> = ({ onClose }) => {
  const maps = useObjectMapDebugSnapshots();

  return (
    <DebugOverlay title="Map Debug (Ctrl+Alt+M)" testId="map-debug-overlay" onClose={onClose}>
      <ObjectMapDebugEntries maps={maps} />
    </DebugOverlay>
  );
};

const ErrorBoundaryDebugOverlay: React.FC<OverlayCloseProps> = ({ onClose }) => {
  return (
    <DebugOverlay
      title="Error Boundary Tests (Ctrl+Alt+E)"
      testId="error-debug-overlay"
      onClose={onClose}
    >
      <React.Suspense fallback={<div className="debug-overlay__meta">Loading error tests...</div>}>
        <DevTestErrorBoundaryLazy embedded />
      </React.Suspense>
    </DebugOverlay>
  );
};
