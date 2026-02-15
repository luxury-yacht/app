/**
 * frontend/src/ui/layout/Sidebar.tsx
 *
 * Module source for Sidebar.
 * Implements Sidebar logic for the UI layer.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import './Sidebar.css';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { useNamespace, type NamespaceListItem } from '@modules/namespace/contexts/NamespaceContext';
import {
  ALL_NAMESPACES_DETAILS,
  ALL_NAMESPACES_DISPLAY_NAME,
  ALL_NAMESPACES_RESOURCE_VERSION,
  ALL_NAMESPACES_SCOPE,
} from '@modules/namespace/constants';
import { useViewState } from '@core/contexts/ViewStateContext';
import {
  ExpandSidebarIcon,
  CollapseSidebarIcon,
  ClusterOverviewIcon,
  ClusterResourcesIcon,
  CategoryIcon,
  NamespaceIcon,
  NamespaceOpenIcon,
} from '@shared/components/icons/MenuIcons';
import type { NamespaceViewType, ClusterViewType } from '@/types/navigation/views';
import { isMacPlatform } from '@/utils/platform';
import type { CatalogNamespaceGroup } from '@/core/refresh/types';
import { useRefreshScopedDomainStates } from '@/core/refresh';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useSidebarKeyboardControls, SidebarCursorTarget } from './SidebarKeys';

// Static cluster view list to avoid re-creating the array each render.
const RESOURCE_VIEWS: Array<{ id: ClusterViewType; label: string }> = [
  { id: 'browse', label: 'Browse' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'config', label: 'Config' },
  { id: 'crds', label: 'CRDs' },
  { id: 'custom', label: 'Custom' },
  { id: 'events', label: 'Events' },
  { id: 'rbac', label: 'RBAC' },
  { id: 'storage', label: 'Storage' },
];

// Static namespace view list to avoid re-creating the array each render.
const NAMESPACE_VIEWS: Array<{ id: NamespaceViewType; label: string }> = [
  { id: 'browse', label: 'Browse' },
  { id: 'workloads', label: 'Workloads' },
  { id: 'pods', label: 'Pods' },
  { id: 'autoscaling', label: 'Autoscaling' },
  { id: 'config', label: 'Config' },
  { id: 'custom', label: 'Custom' },
  { id: 'events', label: 'Events' },
  { id: 'helm', label: 'Helm' },
  { id: 'network', label: 'Network' },
  { id: 'quotas', label: 'Quotas' },
  { id: 'rbac', label: 'RBAC' },
  { id: 'storage', label: 'Storage' },
];

type NamespaceGroup = {
  clusterId: string;
  clusterName: string;
  namespaces: NamespaceListItem[];
};

const toNamespaceKey = (clusterId: string | undefined, scope: string): string => {
  const scoped = buildClusterScope(clusterId, scope);
  return scoped || scope;
};

function Sidebar() {
  const {
    namespaces,
    namespaceLoading,
    setSelectedNamespace,
    selectedNamespace,
    selectedNamespaceClusterId,
  } = useNamespace();
  const { selectedClusterId } = useKubeconfig();
  // Catalog is scoped — read all active scopes and find data for the active cluster.
  const catalogScopedStates = useRefreshScopedDomainStates('catalog');
  const catalogDomain = useMemo(() => {
    // Find the first scope entry that has data (the active catalog scope for this cluster).
    const entries = Object.values(catalogScopedStates);
    for (const entry of entries) {
      if (entry?.data) {
        return entry;
      }
    }
    return { data: null, status: 'idle' as const };
  }, [catalogScopedStates]);
  const viewState = useViewState();
  const [expandedNamespaceKey, setExpandedNamespaceKey] = useState<string | null>(null);
  const [clusterResourcesExpanded, setClusterResourcesExpanded] = useState<boolean>(true);

  const width = viewState.isSidebarVisible ? viewState.sidebarWidth : 50;
  const isCollapsed = !viewState.isSidebarVisible;
  const sidebarSelection = viewState.sidebarSelection;
  const selectedNamespaceRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const overlaySlotRef = useRef<HTMLDivElement>(null);
  const keyboardCursorIndexRef = useRef<number | null>(null);
  const [cursorPreview, setCursorPreview] = useState<SidebarCursorTarget | null>(null);
  const [pendingSelection, setPendingSelection] = useState<SidebarCursorTarget | null>(null);
  const [hasOverlayContent, setHasOverlayContent] = useState(false);
  const [overlayHeight, setOverlayHeight] = useState(400);
  const [isOverlayResizing, setIsOverlayResizing] = useState(false);
  const pendingCommitRef = useRef<SidebarCursorTarget | null>(null);
  const keyboardActivationRef = useRef(false);
  const clearKeyboardPreview = useCallback(() => {
    setCursorPreview(null);
    pendingCommitRef.current = null;
    keyboardCursorIndexRef.current = null;
  }, []);

  const allNamespacesItem = useMemo<NamespaceListItem>(
    () => ({
      name: ALL_NAMESPACES_DISPLAY_NAME,
      scope: ALL_NAMESPACES_SCOPE,
      status: 'All namespaces',
      details: ALL_NAMESPACES_DETAILS,
      age: '—',
      hasWorkloads: true,
      workloadsUnknown: false,
      resourceVersion: ALL_NAMESPACES_RESOURCE_VERSION,
      isSynthetic: true,
    }),
    []
  );

  const namespaceDetailsByScope = useMemo(() => {
    const entries = new Map<string, NamespaceListItem>();
    namespaces.forEach((namespace) => {
      const scope = namespace.scope ?? namespace.name;
      entries.set(scope, namespace);
    });
    return entries;
  }, [namespaces]);

  const hasNamespaceData = !namespaceLoading && namespaces.some((item) => !item.isSynthetic);

  const namespaceGroups = useMemo<NamespaceGroup[]>(() => {
    const groups = catalogDomain.data?.namespaceGroups ?? [];
    const activeClusterId = selectedClusterId?.trim();
    if (!activeClusterId || groups.length === 0) {
      return [];
    }
    const activeGroups = groups.filter((group) => group.clusterId === activeClusterId);
    if (activeGroups.length === 0) {
      return [];
    }

    return activeGroups
      .filter((group): group is CatalogNamespaceGroup & { clusterId: string } => !!group.clusterId)
      .map((group) => {
        const useDetails = group.clusterId === selectedClusterId;
        // Catalog groups only include names, so borrow rich metadata for the active cluster only.
        const enrichedNamespaces = group.namespaces
          .filter((name) => Boolean(name && name.trim()))
          .map((name) => {
            const scope = name.trim();
            if (useDetails) {
              const existing = namespaceDetailsByScope.get(scope);
              if (existing) {
                return existing;
              }
            }
            return {
              name: scope,
              scope,
              status: '',
              details: '',
              age: '',
              hasWorkloads: true,
              workloadsUnknown: false,
              resourceVersion: `catalog-${scope}`,
            } satisfies NamespaceListItem;
          });

        const allNamespaces =
          hasNamespaceData && useDetails
            ? namespaceDetailsByScope.get(ALL_NAMESPACES_SCOPE) || allNamespacesItem
            : null;

        return {
          clusterId: group.clusterId,
          clusterName: group.clusterName || group.clusterId,
          namespaces: allNamespaces ? [allNamespaces, ...enrichedNamespaces] : enrichedNamespaces,
        };
      })
      .sort((a, b) => a.clusterName.localeCompare(b.clusterName));
  }, [
    allNamespacesItem,
    catalogDomain.data?.namespaceGroups,
    hasNamespaceData,
    namespaceDetailsByScope,
    selectedClusterId,
  ]);

  const resolvedSelectionClusterId = selectedNamespaceClusterId ?? selectedClusterId;
  const selectedNamespaceKey = useMemo(() => {
    if (!selectedNamespace) {
      return null;
    }
    return toNamespaceKey(resolvedSelectionClusterId, selectedNamespace);
  }, [resolvedSelectionClusterId, selectedNamespace]);

  const getCurrentSelectionTarget = useCallback((): SidebarCursorTarget | null => {
    if (sidebarSelection?.type === 'overview') {
      return { kind: 'overview' };
    }
    if (viewState.viewType === 'cluster' && viewState.activeClusterTab) {
      return { kind: 'cluster-view', view: viewState.activeClusterTab };
    }
    if (
      sidebarSelection?.type === 'namespace' &&
      sidebarSelection.value &&
      viewState.activeNamespaceTab &&
      selectedNamespaceKey
    ) {
      return {
        kind: 'namespace-view',
        namespace: selectedNamespaceKey,
        view: viewState.activeNamespaceTab,
      };
    }
    return null;
  }, [
    sidebarSelection,
    viewState.activeClusterTab,
    viewState.activeNamespaceTab,
    viewState.viewType,
    selectedNamespaceKey,
  ]);

  const { buildSidebarItemClassName, isKeyboardNavActive } = useSidebarKeyboardControls({
    sidebarRef,
    isCollapsed,
    cursorPreview,
    setCursorPreview,
    pendingSelection,
    setPendingSelection,
    keyboardCursorIndexRef,
    pendingCommitRef,
    keyboardActivationRef,
    clearKeyboardPreview,
    getCurrentSelectionTarget,
  });

  // Cluster view items (always visible)
  const resourceViews = RESOURCE_VIEWS;

  // Namespace view items (shown when namespace is expanded)
  const namespaceViews = NAMESPACE_VIEWS;

  // Scroll selected namespace into view when it changes
  useEffect(() => {
    if (selectedNamespaceRef.current && selectedNamespaceKey) {
      selectedNamespaceRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedNamespaceKey]);

  // Keep expanded namespace in sync with the current selection key.
  useEffect(() => {
    if (selectedNamespaceKey) {
      setExpandedNamespaceKey(selectedNamespaceKey);
    }
  }, [selectedNamespaceKey]);

  // Scroll to show expanded namespace whenever it changes
  useEffect(() => {
    if (expandedNamespaceKey) {
      // Delay to allow expansion animation to complete
      const scrollTimer = setTimeout(() => {
        const namespaceElement = document.querySelector(
          `.sidebar-item[data-namespace="${expandedNamespaceKey}"]`
        );
        if (namespaceElement) {
          const parentContainer = namespaceElement.closest('.namespace-items');
          if (parentContainer) {
            // Get the expanded views container that follows this namespace item
            const expandedViews = namespaceElement.parentElement?.querySelector('.sidebar-views');
            if (expandedViews) {
              // Calculate if we need to scroll to show the entire expanded content
              const containerRect = parentContainer.getBoundingClientRect();
              const namespaceRect = namespaceElement.getBoundingClientRect();
              const expandedRect = expandedViews.getBoundingClientRect();

              // Check if either the namespace item or expanded content is out of view
              const needsScroll =
                namespaceRect.top < containerRect.top || expandedRect.bottom > containerRect.bottom;

              if (needsScroll) {
                // Scroll the namespace item to the top of the container to show everything
                namespaceElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
              }
            }
          }
        }
      }, 200);

      return () => clearTimeout(scrollTimer);
    }
  }, [expandedNamespaceKey]);

  const handleClusterViewSelect = (view: ClusterViewType) => {
    setPendingSelection({ kind: 'cluster-view', view });
    viewState.setViewType('cluster');
    viewState.setActiveClusterView(view);
    viewState.setSidebarSelection({ type: 'cluster', value: 'cluster' });
  };

  const handleNamespaceSelect = (namespaceScope: string, clusterId?: string) => {
    const namespaceKey = toNamespaceKey(clusterId, namespaceScope);
    // Toggle expansion only; namespace selection happens when a view is chosen.
    setExpandedNamespaceKey((previous) => (previous === namespaceKey ? null : namespaceKey));
  };

  const handleNamespaceViewSelect = (
    namespaceScope: string,
    view: NamespaceViewType,
    clusterId?: string
  ) => {
    const namespaceKey = toNamespaceKey(clusterId, namespaceScope);
    setPendingSelection({ kind: 'namespace-view', namespace: namespaceKey, view });
    setSelectedNamespace(namespaceScope, clusterId);

    if (
      viewState.sidebarSelection?.type !== 'namespace' ||
      viewState.sidebarSelection?.value !== namespaceScope
    ) {
      viewState.onNamespaceSelect(namespaceScope);
    } else {
      viewState.setViewType('namespace');
      viewState.setSidebarSelection({ type: 'namespace', value: namespaceScope });
    }

    viewState.setActiveNamespaceTab(view);
  };

  // Fall back to the legacy namespace list until catalog groups are available.
  const namespaceGroupsToRender: NamespaceGroup[] =
    namespaceGroups.length > 0
      ? namespaceGroups
      : [
          {
            clusterId: selectedClusterId ?? '',
            clusterName: '',
            namespaces: namespaces.length > 0 ? namespaces : [],
          },
        ];
  const showClusterLabels = namespaceGroups.length > 1;
  const showNamespaceLoading = namespaceLoading;

  useEffect(() => {
    const slot = overlaySlotRef.current;
    if (!slot) {
      return;
    }

    const updateOverlayPresence = () => {
      setHasOverlayContent(slot.childElementCount > 0);
    };

    updateOverlayPresence();
    const observer = new MutationObserver(updateOverlayPresence);
    observer.observe(slot, { childList: true, subtree: false });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isOverlayResizing) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const sidebarRect = sidebarRef.current?.getBoundingClientRect();
      if (!sidebarRect) {
        return;
      }
      const minHeight = 120;
      const maxHeight = Math.max(minHeight, sidebarRect.height - 120);
      const nextHeight = Math.round(sidebarRect.bottom - event.clientY);
      setOverlayHeight(Math.max(minHeight, Math.min(maxHeight, nextHeight)));
    };

    const handleMouseUp = () => {
      setIsOverlayResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isOverlayResizing]);

  return (
    <div
      className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${
        isKeyboardNavActive ? 'keyboard-mode' : ''
      }`}
      style={{ width: `${width}px` }}
      ref={sidebarRef}
      role="navigation"
      tabIndex={isCollapsed ? -1 : 0}
    >
      <div className="sidebar-content">
        <button
          className="sidebar-toggle"
          onClick={viewState.toggleSidebar}
          title={
            isCollapsed
              ? `Show Sidebar (${isMacPlatform() ? '⌘B' : 'Ctrl+B'})`
              : `Hide Sidebar (${isMacPlatform() ? '⌘B' : 'Ctrl+B'})`
          }
          aria-label={isCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
        >
          {isCollapsed ? (
            <ExpandSidebarIcon width={20} height={20} />
          ) : (
            <CollapseSidebarIcon width={20} height={20} />
          )}
        </button>
        {!isCollapsed && (
          <>
            <div className="sidebar-section">
              <h3>Cluster</h3>
              <div className="cluster-items">
                <div
                  className={buildSidebarItemClassName(['sidebar-item'], { kind: 'overview' })}
                  onClick={() => {
                    if (!keyboardActivationRef.current) {
                      clearKeyboardPreview();
                    }
                    setPendingSelection({ kind: 'overview' });
                    viewState.setViewType('overview');
                    viewState.setSidebarSelection({ type: 'overview', value: 'overview' });
                  }}
                  data-sidebar-focusable="true"
                  data-sidebar-target-kind="overview"
                  tabIndex={-1}
                >
                  <ClusterOverviewIcon width={14} height={14} />
                  <span>Overview</span>
                </div>
                <div
                  className={buildSidebarItemClassName(['sidebar-item', 'header', 'clickable'], {
                    kind: 'cluster-toggle',
                    id: 'resources',
                  })}
                  onClick={() => setClusterResourcesExpanded((previous) => !previous)}
                  data-sidebar-focusable="true"
                  data-sidebar-target-kind="cluster-toggle"
                  data-sidebar-target-id="resources"
                  tabIndex={-1}
                >
                  <ClusterResourcesIcon width={14} height={14} />
                  <span>Resources</span>
                </div>
                {clusterResourcesExpanded && (
                  <div className="sidebar-views">
                    {/* Animate Resources the same way as namespace views. */}
                    {resourceViews.map((view) => (
                      <div
                        key={view.id}
                        className={buildSidebarItemClassName(['sidebar-item', 'indented'], {
                          kind: 'cluster-view',
                          view: view.id,
                        })}
                        onClick={() => {
                          if (!keyboardActivationRef.current) {
                            clearKeyboardPreview();
                          }
                          handleClusterViewSelect(view.id);
                        }}
                        data-sidebar-focusable="true"
                        data-sidebar-target-kind="cluster-view"
                        data-sidebar-target-view={view.id}
                        tabIndex={-1}
                      >
                        <CategoryIcon width={14} height={14} />
                        <span>{view.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="sidebar-section namespaces-section">
              <h3>Namespaces</h3>
              {showNamespaceLoading ? (
                <LoadingSpinner message="Loading namespaces..." />
              ) : (
                <div className="namespace-items">
                  {namespaceGroupsToRender.map((group) => {
                    const groupKey = group.clusterId || group.clusterName || 'default';
                    return (
                      <div key={groupKey} className="namespace-cluster-group">
                        {showClusterLabels && (
                          <div className="namespace-cluster-label" title={group.clusterName}>
                            {group.clusterName}
                          </div>
                        )}
                        {group.namespaces.map((namespace) => {
                          const scope = namespace.scope ?? namespace.name;
                          const namespaceKey = toNamespaceKey(group.clusterId, scope);
                          const isExpanded = expandedNamespaceKey === namespaceKey;

                          return (
                            <div key={namespaceKey}>
                              <div
                                ref={
                                  selectedNamespaceKey === namespaceKey
                                    ? selectedNamespaceRef
                                    : null
                                }
                                className={buildSidebarItemClassName(
                                  [
                                    'sidebar-item',
                                    !namespace.hasWorkloads && !namespace.workloadsUnknown
                                      ? 'dimmed'
                                      : '',
                                    namespace.workloadsUnknown ? 'workloads-unknown' : '',
                                  ].filter(Boolean),
                                  {
                                    kind: 'namespace-toggle',
                                    namespace: namespaceKey,
                                  }
                                )}
                                data-namespace={namespaceKey}
                                onClick={() => {
                                  if (!keyboardActivationRef.current) {
                                    clearKeyboardPreview();
                                  }
                                  handleNamespaceSelect(scope, group.clusterId || undefined);
                                }}
                                data-sidebar-focusable="true"
                                data-sidebar-target-kind="namespace-toggle"
                                data-sidebar-target-namespace={namespaceKey}
                                title={
                                  namespace.workloadsUnknown
                                    ? 'Unable to determine workloads in this namespace (check permissions)'
                                    : namespace.details || undefined
                                }
                                tabIndex={-1}
                              >
                                {isExpanded ? (
                                  <NamespaceOpenIcon width={14} height={14} />
                                ) : (
                                  <NamespaceIcon width={14} height={14} />
                                )}
                                <span>{namespace.name}</span>
                                {namespace.workloadsUnknown && (
                                  <span className="namespace-status-badge">Unknown</span>
                                )}
                              </div>
                              {isExpanded && (
                                <div className="sidebar-views">
                                  {namespaceViews.map((view) => {
                                    const label = view.label;
                                    return (
                                      <div
                                        key={view.id}
                                        className={buildSidebarItemClassName(
                                          ['sidebar-item', 'indented'],
                                          {
                                            kind: 'namespace-view',
                                            namespace: namespaceKey,
                                            view: view.id,
                                          }
                                        )}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!keyboardActivationRef.current) {
                                            clearKeyboardPreview();
                                          }
                                          handleNamespaceViewSelect(
                                            scope,
                                            view.id,
                                            group.clusterId || undefined
                                          );
                                        }}
                                        data-sidebar-focusable="true"
                                        data-sidebar-target-kind="namespace-view"
                                        data-sidebar-target-namespace={namespaceKey}
                                        data-sidebar-target-view={view.id}
                                        tabIndex={-1}
                                      >
                                        <CategoryIcon width={14} height={14} />
                                        <span>{label}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div
        className={`sidebar-overlay-content${hasOverlayContent && !isCollapsed ? ' sidebar-overlay-content--visible' : ''}`}
        style={{ height: `${overlayHeight}px` }}
      >
        <div
          className="sidebar-overlay-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize debug overlay"
          onMouseDown={(event) => {
            event.preventDefault();
            setIsOverlayResizing(true);
          }}
        />
        <div className="sidebar-overlay-slot" ref={overlaySlotRef} />
      </div>
    </div>
  );
}

export default React.memo(Sidebar);
