/**
 * frontend/src/ui/layout/Sidebar.tsx
 *
 * Module source for Sidebar.
 * Implements Sidebar logic for the UI layer.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import './Sidebar.css';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import {
  CategoryIcon,
  CloseIcon,
  ClusterOverviewIcon,
  ClusterResourcesIcon,
  CollapseSidebarIcon,
  ExpandSidebarIcon,
  NamespaceIcon,
  NamespaceOpenIcon,
  SearchIcon,
  WarningIcon,
} from '@shared/components/icons/SharedIcons';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { useRefreshDomainHandle } from '@/core/data-access';
import { eventBus } from '@/core/events';
import {
  CLUSTER_VIEW_DESCRIPTORS,
  GLOBAL_VIEW_DESCRIPTORS,
  NAMESPACE_VIEW_DESCRIPTORS,
} from '@/core/navigation/viewRegistry';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { useStreamSignalRefetch } from '@/core/refresh/hooks/useStreamSignalRefetch';
import type { AttentionSeverity } from '@/core/refresh/types';
import { useDimInactiveNamespaces } from '@/hooks/useDimInactiveNamespaces';
import { useExclusiveNamespaces } from '@/hooks/useExclusiveNamespaces';
import type { ClusterViewType, GlobalViewType, NamespaceViewType } from '@/types/navigation/views';
import { isMacPlatform } from '@/utils/platform';
import { NamespaceScopeAddRow, useNamespaceScope } from './NamespaceScopeEditor';
import { type SidebarCursorTarget, useSidebarKeyboardControls } from './SidebarKeys';

const toNamespaceKey = (clusterId: string | undefined, scope: string): string => {
  const scoped = buildClusterScope(clusterId, scope);
  return scoped || scope;
};

const escapeAttributeSelectorValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const attentionBadgeVariants = {
  info: 'info',
  warning: 'warning',
  error: 'unhealthy',
} satisfies Record<AttentionSeverity, StatusChipVariant>;

function Sidebar() {
  const elementIdPrefix = useId();
  const {
    namespaces,
    namespaceLoading,
    namespacesPermissionDenied,
    setSelectedNamespace,
    selectedNamespace,
    selectedNamespaceClusterId,
  } = useNamespace();
  const { suppressPassiveLoading } = useAutoRefreshLoadingState();
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();
  // The active cluster's "accessible namespaces" scope
  // (docs/plans/namespace-scope.md): the namespaces section doubles as its
  // inline editor when a scope is set or the cluster-wide list is denied.
  const namespaceScope = useNamespaceScope(selectedClusterId || undefined);
  const dimInactiveNamespaces = useDimInactiveNamespaces();
  const exclusiveNamespaces = useExclusiveNamespaces();
  // The namespaces domain is the ONLY membership source. It is
  // permission-gated backend-side: without list permission it fails fast and
  // the sidebar renders the permission message — no catalog inference (manual
  // namespace entry is future work, docs/todo.md).
  const viewState = useViewState();
  const showGlobalViews = selectedClusterIds.length > 1 && viewState.viewType === 'global';
  const [expandedNamespaceKeys, setExpandedNamespaceKeys] = useState<Set<string>>(() => new Set());
  const [lastExpandedNamespaceKey, setLastExpandedNamespaceKey] = useState<string | null>(null);
  const [clusterResourcesExpanded, setClusterResourcesExpanded] = useState<boolean>(true);

  const width = viewState.isSidebarVisible ? viewState.sidebarWidth : 50;
  const isCollapsed = !viewState.isSidebarVisible;
  const attentionScope = buildClusterScope(selectedClusterId, '');
  const attentionBadgesEnabled = Boolean(attentionScope) && viewState.viewType !== 'global';
  const { data: attentionData } = useRefreshDomainHandle({
    domain: 'cluster-attention',
    scope: attentionScope,
    enabled: attentionBadgesEnabled,
    preserveState: true,
  });
  useStreamSignalRefetch('cluster-attention', attentionBadgesEnabled ? [attentionScope] : []);
  const sidebarSelection = viewState.sidebarSelection;
  const selectedNamespaceRef = useRef<HTMLButtonElement>(null);
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

  const hasNamespaceData = !namespaceLoading && namespaces.some((item) => !item.isSynthetic);

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
    if (viewState.viewType === 'global') {
      return { kind: 'global-view', view: viewState.activeGlobalTab };
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
    viewState.activeGlobalTab,
    viewState.activeNamespaceTab,
    viewState.viewType,
    selectedNamespaceKey,
  ]);

  const { buildSidebarItemClassName, isTargetSelected, isKeyboardNavActive } =
    useSidebarKeyboardControls({
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
  const attentionView = CLUSTER_VIEW_DESCRIPTORS.find((view) => view.id === 'attention');
  const resourceViews = CLUSTER_VIEW_DESCRIPTORS.filter((view) => view.id !== 'attention');

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
      setLastExpandedNamespaceKey(selectedNamespaceKey);
      setExpandedNamespaceKeys((previous) => {
        if (exclusiveNamespaces) {
          if (previous.size === 1 && previous.has(selectedNamespaceKey)) {
            return previous;
          }
          return new Set([selectedNamespaceKey]);
        }
        if (previous.has(selectedNamespaceKey)) {
          return previous;
        }
        const next = new Set(previous);
        next.add(selectedNamespaceKey);
        return next;
      });
    }
  }, [exclusiveNamespaces, selectedNamespaceKey]);

  // When switching back to exclusive expansion, keep the active namespace open
  // when possible and collapse any other expanded namespace groups.
  useEffect(() => {
    if (!exclusiveNamespaces) {
      return;
    }
    if (expandedNamespaceKeys.size <= 1) {
      return;
    }
    const selectedExpanded =
      selectedNamespaceKey && expandedNamespaceKeys.has(selectedNamespaceKey);
    const namespaceToKeep = selectedExpanded
      ? selectedNamespaceKey
      : Array.from(expandedNamespaceKeys)[0];
    setLastExpandedNamespaceKey(namespaceToKeep);
    setExpandedNamespaceKeys(new Set([namespaceToKeep]));
  }, [exclusiveNamespaces, expandedNamespaceKeys, selectedNamespaceKey]);

  // Scroll to show expanded namespace whenever it changes
  useEffect(() => {
    if (lastExpandedNamespaceKey) {
      // Delay to allow expansion animation to complete
      const scrollTimer = setTimeout(() => {
        const escapedNamespaceKey = escapeAttributeSelectorValue(lastExpandedNamespaceKey);
        const namespaceElement = document.querySelector(
          `.sidebar-item[data-namespace="${escapedNamespaceKey}"]`
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
  }, [lastExpandedNamespaceKey]);

  const handleClusterViewSelect = (view: ClusterViewType) => {
    setPendingSelection({ kind: 'cluster-view', view });
    // Set activeClusterView BEFORE setViewType so the orchestrator context
    // has the correct view when triggerManualRefreshForContext() fires.
    viewState.setActiveClusterView(view);
    viewState.setViewType('cluster');
    viewState.setSidebarSelection({ type: 'cluster', value: 'cluster' });
  };

  const handleGlobalViewSelect = (view: GlobalViewType) => {
    setPendingSelection({ kind: 'global-view', view });
    viewState.navigateToGlobal(view);
  };

  const handleNamespaceSelect = (selectedNamespaceScope: string, clusterId?: string) => {
    const namespaceKey = toNamespaceKey(clusterId, selectedNamespaceScope);
    // Toggle expansion only; namespace selection happens when a view is chosen.
    const isExpanded = expandedNamespaceKeys.has(namespaceKey);
    if (isExpanded) {
      if (lastExpandedNamespaceKey === namespaceKey) {
        setLastExpandedNamespaceKey(null);
      }
    } else {
      setLastExpandedNamespaceKey(namespaceKey);
    }

    setExpandedNamespaceKeys((previous) => {
      if (previous.has(namespaceKey)) {
        const next = new Set(previous);
        next.delete(namespaceKey);
        return next;
      }

      if (exclusiveNamespaces) {
        return new Set([namespaceKey]);
      }

      const next = new Set(previous);
      next.add(namespaceKey);
      return next;
    });
  };

  const handleNamespaceViewSelect = (
    viewNamespaceScope: string,
    view: NamespaceViewType,
    clusterId?: string
  ) => {
    const namespaceKey = toNamespaceKey(clusterId, viewNamespaceScope);
    setPendingSelection({ kind: 'namespace-view', namespace: namespaceKey, view });
    setSelectedNamespace(viewNamespaceScope, clusterId);

    if (
      viewState.sidebarSelection?.type !== 'namespace' ||
      viewState.sidebarSelection?.value !== viewNamespaceScope
    ) {
      viewState.onNamespaceSelect(viewNamespaceScope);
    } else {
      viewState.setViewType('namespace');
      viewState.setSidebarSelection({ type: 'namespace', value: viewNamespaceScope });
    }

    viewState.setActiveNamespaceTab(view);
  };

  const showNamespaceLoading = namespaceLoading && !namespacesPermissionDenied;
  const showNamespacePausedMessage =
    suppressPassiveLoading &&
    !showNamespaceLoading &&
    !hasNamespaceData &&
    !namespacesPermissionDenied;

  return (
    <nav
      className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${
        isKeyboardNavActive ? 'keyboard-mode' : ''
      }`}
      style={{ width: `${width}px` }}
      ref={sidebarRef}
      tabIndex={isCollapsed ? -1 : 0}
      data-app-region="sidebar"
    >
      <div className="sidebar-content">
        <button
          type="button"
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
            {showGlobalViews ? (
              <div className="sidebar-section">
                <h3>Global</h3>
                <div className="cluster-items">
                  {GLOBAL_VIEW_DESCRIPTORS.map((view) => (
                    <button
                      type="button"
                      key={view.id}
                      className={buildSidebarItemClassName(['sidebar-item'], {
                        kind: 'global-view',
                        view: view.id,
                      })}
                      onClick={() => {
                        if (!keyboardActivationRef.current) {
                          clearKeyboardPreview();
                        }
                        handleGlobalViewSelect(view.id);
                      }}
                      data-sidebar-focusable="true"
                      data-sidebar-scope="global"
                      data-sidebar-target-kind="global-view"
                      data-sidebar-target-view={view.id}
                      tabIndex={-1}
                      aria-current={
                        isTargetSelected({ kind: 'global-view', view: view.id })
                          ? 'page'
                          : undefined
                      }
                    >
                      <CategoryIcon width={14} height={14} />
                      <span>{view.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="sidebar-section" hidden={viewState.viewType === 'global'}>
              <h3>Cluster</h3>
              <div className="cluster-items">
                <button
                  type="button"
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
                  aria-current={isTargetSelected({ kind: 'overview' }) ? 'page' : undefined}
                >
                  <ClusterOverviewIcon width={14} height={14} />
                  <span>Overview</span>
                </button>
                {attentionView ? (
                  <button
                    type="button"
                    className={buildSidebarItemClassName(['sidebar-item'], {
                      kind: 'cluster-view',
                      view: attentionView.id,
                    })}
                    onClick={() => handleClusterViewSelect(attentionView.id)}
                    data-sidebar-focusable="true"
                    data-sidebar-target-kind="cluster-view"
                    data-sidebar-target-view={attentionView.id}
                    tabIndex={-1}
                    aria-label={
                      attentionData?.severityCounts
                        ? `${attentionView.label}: ${attentionData.severityCounts.info} info, ${attentionData.severityCounts.warning} warning${attentionData.severityCounts.warning === 1 ? '' : 's'}, ${attentionData.severityCounts.error} error${attentionData.severityCounts.error === 1 ? '' : 's'}`
                        : attentionView.label
                    }
                    aria-current={
                      isTargetSelected({ kind: 'cluster-view', view: attentionView.id })
                        ? 'page'
                        : undefined
                    }
                  >
                    <WarningIcon width={14} height={14} />
                    <span className="sidebar-attention-label">{attentionView.label}</span>
                    {attentionData?.severityCounts ? (
                      <span className="sidebar-attention-badges">
                        {(
                          [
                            ['info', attentionData.severityCounts.info],
                            ['warning', attentionData.severityCounts.warning],
                            ['error', attentionData.severityCounts.error],
                          ] as const
                        ).map(([severity, count]) =>
                          count > 0 ? (
                            <span
                              key={severity}
                              className="sidebar-attention-badge-wrapper"
                              aria-hidden="true"
                              title={`${count} ${severity} finding${count === 1 ? '' : 's'}`}
                            >
                              <StatusChip
                                variant={attentionBadgeVariants[severity]}
                                className={`sidebar-attention-badge sidebar-attention-badge--${severity}`}
                              >
                                {count}
                              </StatusChip>
                            </span>
                          ) : null
                        )}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={buildSidebarItemClassName(['sidebar-item', 'header', 'clickable'], {
                    kind: 'cluster-toggle',
                    id: 'resources',
                  })}
                  onClick={() => setClusterResourcesExpanded((previous) => !previous)}
                  data-sidebar-focusable="true"
                  data-sidebar-target-kind="cluster-toggle"
                  data-sidebar-target-id="resources"
                  tabIndex={-1}
                  aria-expanded={clusterResourcesExpanded}
                  aria-controls={`${elementIdPrefix}-sidebar-cluster-resource-views`}
                >
                  <ClusterResourcesIcon width={14} height={14} />
                  <span>Resources</span>
                </button>
                {!!clusterResourcesExpanded && (
                  <div
                    className="sidebar-views"
                    id={`${elementIdPrefix}-sidebar-cluster-resource-views`}
                  >
                    {/* Animate Resources the same way as namespace views. */}
                    {resourceViews.map((view) => (
                      <button
                        type="button"
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
                        aria-current={
                          isTargetSelected({ kind: 'cluster-view', view: view.id })
                            ? 'page'
                            : undefined
                        }
                      >
                        <CategoryIcon width={14} height={14} />
                        <span>{view.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div
              className="sidebar-section namespaces-section"
              hidden={viewState.viewType === 'global'}
            >
              <h3>
                Namespaces
                <button
                  type="button"
                  className="sidebar-header-action"
                  title={`Select namespace (${isMacPlatform() ? '⇧⌘N' : 'Ctrl+Shift+N'})`}
                  aria-label="Select namespace"
                  onClick={() => eventBus.emit('command-palette:open-namespaces')}
                >
                  <SearchIcon width={12} height={12} />
                </button>
              </h3>
              {namespacesPermissionDenied ? (
                // Fail fast: the namespaces domain is permission-gated
                // backend-side; there is no fallback inference. The inline
                // scope editor below is the way in for a restricted identity
                // (docs/plans/namespace-scope.md): added names become the
                // cluster's "accessible namespaces" scope.
                <>
                  <div className="sidebar-empty-message">
                    Insufficient permission to list namespaces. You may manually add the namespaces
                    you are allowed to access:
                  </div>
                  <NamespaceScopeAddRow state={namespaceScope} />
                </>
              ) : showNamespaceLoading ? (
                <LoadingSpinner message="Loading namespaces..." />
              ) : showNamespacePausedMessage ? (
                <ClusterDataPausedState className="sidebar-empty-message" />
              ) : (
                <div className="namespace-items">
                  {namespaces.map((namespace) => {
                    const scope = namespace.scope ?? namespace.name;
                    const namespaceKey = toNamespaceKey(selectedClusterId ?? '', scope);
                    // An inaccessible scope entry (not-found / no-access) has
                    // no views to offer: it cannot expand, is skipped by
                    // keyboard navigation, and only supports hover-delete.
                    const inaccessible = Boolean(namespace.scopeStatus);
                    const isExpanded = !inaccessible && expandedNamespaceKeys.has(namespaceKey);
                    const namespaceViewsId = `sidebar-namespace-${encodeURIComponent(namespaceKey)}-views`;
                    const namespaceViews =
                      scope === ALL_NAMESPACES_SCOPE
                        ? NAMESPACE_VIEW_DESCRIPTORS.filter((view) => view.supportsAllNamespaces)
                        : NAMESPACE_VIEW_DESCRIPTORS;

                    return (
                      <div key={namespaceKey}>
                        <div className="sidebar-item-row">
                          <button
                            type="button"
                            ref={
                              selectedNamespaceKey === namespaceKey ? selectedNamespaceRef : null
                            }
                            className={buildSidebarItemClassName(
                              [
                                'sidebar-item',
                                inaccessible ? 'scope-inaccessible' : '',
                                // Only a CONFIRMED absence of workloads changes the
                                // presentation; while workload presence is still
                                // unknown (ingest stores settling after connect) the
                                // namespace renders exactly like a normal one.
                                dimInactiveNamespaces &&
                                !namespace.hasWorkloads &&
                                !namespace.workloadsUnknown
                                  ? 'dimmed'
                                  : '',
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
                              if (inaccessible) {
                                return;
                              }
                              handleNamespaceSelect(scope, selectedClusterId || undefined);
                            }}
                            data-sidebar-focusable={inaccessible ? undefined : 'true'}
                            data-sidebar-target-kind="namespace-toggle"
                            data-sidebar-target-namespace={namespaceKey}
                            title={namespace.details || undefined}
                            tabIndex={-1}
                            disabled={inaccessible}
                            aria-expanded={inaccessible ? undefined : isExpanded}
                            aria-controls={inaccessible ? undefined : namespaceViewsId}
                          >
                            {isExpanded ? (
                              <NamespaceOpenIcon width={14} height={14} />
                            ) : (
                              <NamespaceIcon width={14} height={14} />
                            )}
                            <span>{namespace.name}</span>
                            {namespace.scopeStatus ? (
                              <span
                                className="namespace-scope-flag"
                                title={
                                  namespace.scopeStatus === 'not-found'
                                    ? 'Namespace not found on the cluster.'
                                    : 'Insufficient permissions to access this namespace (or it does not exist).'
                                }
                              >
                                <WarningIcon width={16} height={16} />
                              </span>
                            ) : null}
                          </button>
                          {namespaceScope.scope.includes(namespace.name) &&
                          scope !== ALL_NAMESPACES_SCOPE ? (
                            <button
                              type="button"
                              className="namespace-scope-remove"
                              title={`Remove "${namespace.name}" from accessible namespaces`}
                              disabled={namespaceScope.saving}
                              onClick={(event) => {
                                // The row click expands/navigates; removal is
                                // its own action.
                                event.stopPropagation();
                                namespaceScope.removeNamespace(namespace.name);
                              }}
                            >
                              <CloseIcon width={12} height={12} />
                            </button>
                          ) : null}
                        </div>
                        {!!isExpanded && (
                          <div className="sidebar-views" id={namespaceViewsId}>
                            {namespaceViews.map((view) => (
                              <button
                                type="button"
                                key={view.id}
                                className={buildSidebarItemClassName(['sidebar-item', 'indented'], {
                                  kind: 'namespace-view',
                                  namespace: namespaceKey,
                                  view: view.id,
                                })}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!keyboardActivationRef.current) {
                                    clearKeyboardPreview();
                                  }
                                  handleNamespaceViewSelect(
                                    scope,
                                    view.id,
                                    selectedClusterId || undefined
                                  );
                                }}
                                data-sidebar-focusable="true"
                                data-sidebar-target-kind="namespace-view"
                                data-sidebar-target-namespace={namespaceKey}
                                data-sidebar-target-view={view.id}
                                tabIndex={-1}
                                aria-current={
                                  isTargetSelected({
                                    kind: 'namespace-view',
                                    namespace: namespaceKey,
                                    view: view.id,
                                  })
                                    ? 'page'
                                    : undefined
                                }
                              >
                                <CategoryIcon width={14} height={14} />
                                <span>{view.label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {namespaceScope.scope.length > 0 ? (
                    // A scoped cluster's list is user-curated: the same
                    // add affordance that created it stays available.
                    <NamespaceScopeAddRow state={namespaceScope} />
                  ) : null}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

export default React.memo(Sidebar);
