import React, { useEffect, useRef, useState, useCallback } from 'react';
import './Sidebar.css';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { isAllNamespaces } from '@modules/namespace/constants';
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
import { useSidebarKeyboardControls, SidebarCursorTarget } from './SidebarKeys';

// Static cluster view list to avoid re-creating the array each render.
const RESOURCE_VIEWS: Array<{ id: ClusterViewType; label: string }> = [
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
  { id: 'objects', label: 'All Objects' },
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

function Sidebar() {
  const { namespaces, namespaceLoading, setSelectedNamespace } = useNamespace();
  const viewState = useViewState();
  const [expandedNamespace, setExpandedNamespace] = useState<string | null>(null);
  const [clusterResourcesExpanded, setClusterResourcesExpanded] = useState<boolean>(true);

  const width = viewState.isSidebarVisible ? viewState.sidebarWidth : 50;
  const isCollapsed = !viewState.isSidebarVisible;
  const sidebarSelection = viewState.sidebarSelection;
  const selectedNamespaceRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const keyboardCursorIndexRef = useRef<number | null>(null);
  const [cursorPreview, setCursorPreview] = useState<SidebarCursorTarget | null>(null);
  const [pendingSelection, setPendingSelection] = useState<SidebarCursorTarget | null>(null);
  const pendingCommitRef = useRef<SidebarCursorTarget | null>(null);
  const keyboardActivationRef = useRef(false);
  const clearKeyboardPreview = useCallback(() => {
    setCursorPreview(null);
    pendingCommitRef.current = null;
    keyboardCursorIndexRef.current = null;
  }, []);

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
      viewState.activeNamespaceTab
    ) {
      return {
        kind: 'namespace-view',
        namespace: sidebarSelection.value,
        view: viewState.activeNamespaceTab,
      };
    }
    return null;
  }, [
    sidebarSelection,
    viewState.activeClusterTab,
    viewState.activeNamespaceTab,
    viewState.viewType,
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
    if (selectedNamespaceRef.current && sidebarSelection?.type === 'namespace') {
      selectedNamespaceRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [sidebarSelection]);

  // Keep expanded namespace in sync with selection
  useEffect(() => {
    if (sidebarSelection?.type === 'namespace' && sidebarSelection?.value) {
      setExpandedNamespace(sidebarSelection.value);
    }
  }, [sidebarSelection]);

  // Scroll to show expanded namespace whenever it changes
  useEffect(() => {
    if (expandedNamespace) {
      // Delay to allow expansion animation to complete
      const scrollTimer = setTimeout(() => {
        const namespaceElement = document.querySelector(
          `.sidebar-item[data-namespace="${expandedNamespace}"]`
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
  }, [expandedNamespace]);

  const handleClusterViewSelect = (view: ClusterViewType) => {
    setPendingSelection({ kind: 'cluster-view', view });
    viewState.setViewType('cluster');
    viewState.setActiveClusterView(view);
    viewState.setSidebarSelection({ type: 'cluster', value: 'cluster' });
  };

  const handleNamespaceSelect = (namespaceScope: string) => {
    if (isAllNamespaces(namespaceScope)) {
      setExpandedNamespace((previous) => (previous === namespaceScope ? null : namespaceScope));
      return;
    }
    // Keep the namespace expanded unless another namespace is selected.
    setExpandedNamespace(namespaceScope);
    setSelectedNamespace(namespaceScope);
    viewState.onNamespaceSelect(namespaceScope);
  };

  const handleNamespaceViewSelect = (namespaceScope: string, view: NamespaceViewType) => {
    setPendingSelection({ kind: 'namespace-view', namespace: namespaceScope, view });
    setSelectedNamespace(namespaceScope);

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
          title={isCollapsed ? 'Show Sidebar (B)' : 'Hide Sidebar (B)'}
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
                  className={buildSidebarItemClassName(['sidebar-item'], {
                    kind: 'cluster-view',
                    view: 'browse',
                  })}
                  onClick={() => {
                    if (!keyboardActivationRef.current) {
                      clearKeyboardPreview();
                    }
                    handleClusterViewSelect('browse');
                  }}
                  data-sidebar-focusable="true"
                  data-sidebar-target-kind="cluster-view"
                  data-sidebar-target-view="browse"
                  tabIndex={-1}
                >
                  <CategoryIcon width={14} height={14} />
                  <span>Browse</span>
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
              {namespaceLoading ? (
                <LoadingSpinner message="Loading namespaces..." />
              ) : (
                <div className="namespace-items">
                  {namespaces.map((namespace) => {
                    const scope = namespace.scope ?? namespace.name;
                    const key = `${scope}-${namespace.resourceVersion}`;
                    const isExpanded = expandedNamespace === scope;

                    return (
                      <div key={key}>
                        <div
                          ref={
                            sidebarSelection?.type === 'namespace' &&
                            sidebarSelection?.value === scope
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
                              namespace: scope,
                            }
                          )}
                          data-namespace={scope}
                          onClick={() => {
                            if (!keyboardActivationRef.current) {
                              clearKeyboardPreview();
                            }
                            handleNamespaceSelect(scope);
                          }}
                          data-sidebar-focusable="true"
                          data-sidebar-target-kind="namespace-toggle"
                          data-sidebar-target-namespace={scope}
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
                            {namespaceViews
                              .filter((view) => !(isAllNamespaces(scope) && view.id === 'objects'))
                              .map((view) => {
                                const label = view.id === 'objects' ? `All Objects` : view.label;
                                return (
                                  <div
                                    key={view.id}
                                    className={buildSidebarItemClassName(
                                      ['sidebar-item', 'indented'],
                                      {
                                        kind: 'namespace-view',
                                        namespace: scope,
                                        view: view.id,
                                      }
                                    )}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!keyboardActivationRef.current) {
                                        clearKeyboardPreview();
                                      }
                                      handleNamespaceViewSelect(scope, view.id);
                                    }}
                                    data-sidebar-focusable="true"
                                    data-sidebar-target-kind="namespace-view"
                                    data-sidebar-target-namespace={scope}
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
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default React.memo(Sidebar);
