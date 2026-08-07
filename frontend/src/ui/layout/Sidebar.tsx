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

const expandSelectedNamespace = (
  previous: Set<string>,
  selectedNamespaceKey: string,
  exclusive: boolean
) => {
  if (exclusive) {
    return previous.size === 1 && previous.has(selectedNamespaceKey)
      ? previous
      : new Set([selectedNamespaceKey]);
  }
  if (previous.has(selectedNamespaceKey)) {
    return previous;
  }
  const next = new Set(previous);
  next.add(selectedNamespaceKey);
  return next;
};

const scrollExpandedNamespaceIntoView = (namespaceKey: string) => {
  const escapedKey = escapeAttributeSelectorValue(namespaceKey);
  const namespaceElement = document.querySelector(`.sidebar-item[data-namespace="${escapedKey}"]`);
  const parentContainer = namespaceElement?.closest('.namespace-items');
  const expandedViews = namespaceElement?.parentElement?.querySelector('.sidebar-views');
  if (!namespaceElement || !parentContainer || !expandedViews) {
    return;
  }

  const containerRect = parentContainer.getBoundingClientRect();
  const namespaceRect = namespaceElement.getBoundingClientRect();
  const expandedRect = expandedViews.getBoundingClientRect();
  const needsScroll =
    namespaceRect.top < containerRect.top || expandedRect.bottom > containerRect.bottom;
  if (needsScroll) {
    namespaceElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
};

type NamespaceRow = ReturnType<typeof useNamespace>['namespaces'][number];
type NamespaceScopeState = ReturnType<typeof useNamespaceScope>;
type SidebarKeyboardControls = ReturnType<typeof useSidebarKeyboardControls>;

interface SidebarNamespaceRowProps {
  namespace: NamespaceRow;
  selectedClusterId?: string;
  selectedNamespaceKey: string | null;
  selectedNamespaceRef: React.RefObject<HTMLButtonElement | null>;
  expandedNamespaceKeys: Set<string>;
  dimInactiveNamespaces: boolean;
  namespaceScope: NamespaceScopeState;
  keyboardActivationRef: React.RefObject<boolean>;
  clearKeyboardPreview: () => void;
  buildSidebarItemClassName: SidebarKeyboardControls['buildSidebarItemClassName'];
  isTargetSelected: SidebarKeyboardControls['isTargetSelected'];
  onNamespaceSelect: (scope: string, clusterId?: string) => void;
  onNamespaceViewSelect: (scope: string, view: NamespaceViewType, clusterId?: string) => void;
}

const getNamespaceViews = (scope: string) =>
  scope === ALL_NAMESPACES_SCOPE
    ? NAMESPACE_VIEW_DESCRIPTORS.filter((view) => view.supportsAllNamespaces)
    : NAMESPACE_VIEW_DESCRIPTORS;

const getNamespaceStatusTitle = (status: NamespaceRow['scopeStatus']) =>
  status === 'not-found'
    ? 'Namespace not found on the cluster.'
    : 'Insufficient permissions to access this namespace (or it does not exist).';

const SidebarNamespaceStatus = ({ status }: { status: NamespaceRow['scopeStatus'] }) => {
  if (!status) {
    return null;
  }
  return (
    <span className="namespace-scope-flag" title={getNamespaceStatusTitle(status)}>
      <WarningIcon width={16} height={16} />
    </span>
  );
};

const SidebarNamespaceRemove = ({
  namespace,
  scope,
  namespaceScope,
}: {
  namespace: NamespaceRow;
  scope: string;
  namespaceScope: NamespaceScopeState;
}) => {
  if (!namespaceScope.scope.includes(namespace.name) || scope === ALL_NAMESPACES_SCOPE) {
    return null;
  }
  return (
    <button
      type="button"
      className="namespace-scope-remove"
      title={`Remove "${namespace.name}" from accessible namespaces`}
      disabled={namespaceScope.saving}
      onClick={(event) => {
        event.stopPropagation();
        namespaceScope.removeNamespace(namespace.name);
      }}
    >
      <CloseIcon width={12} height={12} />
    </button>
  );
};

interface SidebarNamespaceViewsProps {
  isExpanded: boolean;
  namespaceViewsId: string;
  namespaceKey: string;
  scope: string;
  selectedClusterId?: string;
  keyboardActivationRef: React.RefObject<boolean>;
  clearKeyboardPreview: () => void;
  buildSidebarItemClassName: SidebarKeyboardControls['buildSidebarItemClassName'];
  isTargetSelected: SidebarKeyboardControls['isTargetSelected'];
  onNamespaceViewSelect: (scope: string, view: NamespaceViewType, clusterId?: string) => void;
}

const SidebarNamespaceViews = ({
  isExpanded,
  namespaceViewsId,
  namespaceKey,
  scope,
  selectedClusterId,
  keyboardActivationRef,
  clearKeyboardPreview,
  buildSidebarItemClassName,
  isTargetSelected,
  onNamespaceViewSelect,
}: SidebarNamespaceViewsProps) => {
  if (!isExpanded) {
    return null;
  }
  return (
    <div className="sidebar-views" id={namespaceViewsId}>
      {getNamespaceViews(scope).map((view) => (
        <button
          type="button"
          key={view.id}
          className={buildSidebarItemClassName(['sidebar-item', 'indented'], {
            kind: 'namespace-view',
            namespace: namespaceKey,
            view: view.id,
          })}
          onClick={(event) => {
            event.stopPropagation();
            if (!keyboardActivationRef.current) {
              clearKeyboardPreview();
            }
            onNamespaceViewSelect(scope, view.id, selectedClusterId);
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
  );
};

const SidebarNamespaceRow = ({
  namespace,
  selectedClusterId,
  selectedNamespaceKey,
  selectedNamespaceRef,
  expandedNamespaceKeys,
  dimInactiveNamespaces,
  namespaceScope,
  keyboardActivationRef,
  clearKeyboardPreview,
  buildSidebarItemClassName,
  isTargetSelected,
  onNamespaceSelect,
  onNamespaceViewSelect,
}: SidebarNamespaceRowProps) => {
  const scope = namespace.scope ?? namespace.name;
  const namespaceKey = toNamespaceKey(selectedClusterId, scope);
  const inaccessible = Boolean(namespace.scopeStatus);
  const isExpanded = !inaccessible && expandedNamespaceKeys.has(namespaceKey);
  const namespaceViewsId = `sidebar-namespace-${encodeURIComponent(namespaceKey)}-views`;
  const isDimmed = dimInactiveNamespaces && !namespace.hasWorkloads && !namespace.workloadsUnknown;
  const handleToggle = () => {
    if (!keyboardActivationRef.current) {
      clearKeyboardPreview();
    }
    if (!inaccessible) {
      onNamespaceSelect(scope, selectedClusterId);
    }
  };

  return (
    <div>
      <div className="sidebar-item-row">
        <button
          type="button"
          ref={selectedNamespaceKey === namespaceKey ? selectedNamespaceRef : null}
          className={buildSidebarItemClassName(
            [
              'sidebar-item',
              inaccessible ? 'scope-inaccessible' : '',
              isDimmed ? 'dimmed' : '',
            ].filter(Boolean),
            { kind: 'namespace-toggle', namespace: namespaceKey }
          )}
          data-namespace={namespaceKey}
          onClick={handleToggle}
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
          <SidebarNamespaceStatus status={namespace.scopeStatus} />
        </button>
        <SidebarNamespaceRemove
          namespace={namespace}
          scope={scope}
          namespaceScope={namespaceScope}
        />
      </div>
      <SidebarNamespaceViews
        isExpanded={isExpanded}
        namespaceViewsId={namespaceViewsId}
        namespaceKey={namespaceKey}
        scope={scope}
        selectedClusterId={selectedClusterId}
        keyboardActivationRef={keyboardActivationRef}
        clearKeyboardPreview={clearKeyboardPreview}
        buildSidebarItemClassName={buildSidebarItemClassName}
        isTargetSelected={isTargetSelected}
        onNamespaceViewSelect={onNamespaceViewSelect}
      />
    </div>
  );
};

const SidebarToggle = ({
  isCollapsed,
  shortcut,
  onToggle,
}: {
  isCollapsed: boolean;
  shortcut: string;
  onToggle: () => void;
}) => (
  <button
    type="button"
    className="sidebar-toggle"
    onClick={onToggle}
    title={`${isCollapsed ? 'Show' : 'Hide'} Sidebar (${shortcut})`}
    aria-label={isCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
  >
    {isCollapsed ? (
      <ExpandSidebarIcon width={20} height={20} />
    ) : (
      <CollapseSidebarIcon width={20} height={20} />
    )}
  </button>
);

interface GlobalSidebarSectionProps {
  show: boolean;
  buildSidebarItemClassName: SidebarKeyboardControls['buildSidebarItemClassName'];
  isTargetSelected: SidebarKeyboardControls['isTargetSelected'];
  onSelect: (view: GlobalViewType) => void;
}

const GlobalSidebarSection = ({
  show,
  buildSidebarItemClassName,
  isTargetSelected,
  onSelect,
}: GlobalSidebarSectionProps) => {
  if (!show) {
    return null;
  }
  return (
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
            onClick={() => onSelect(view.id)}
            data-sidebar-focusable="true"
            data-sidebar-scope="global"
            data-sidebar-target-kind="global-view"
            data-sidebar-target-view={view.id}
            tabIndex={-1}
            aria-current={
              isTargetSelected({ kind: 'global-view', view: view.id }) ? 'page' : undefined
            }
          >
            <CategoryIcon width={14} height={14} />
            <span>{view.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

type ClusterViewDescriptor = (typeof CLUSTER_VIEW_DESCRIPTORS)[number];
type AttentionCounts = Record<AttentionSeverity, number>;

const SidebarAttentionBadges = ({ counts }: { counts?: AttentionCounts }) => {
  if (!counts) {
    return null;
  }
  return (
    <span className="sidebar-attention-badges">
      {(['info', 'warning', 'error'] as const).map((severity) => {
        const count = counts[severity];
        if (count === 0) {
          return null;
        }
        return (
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
        );
      })}
    </span>
  );
};

interface ClusterSidebarSectionProps {
  hidden: boolean;
  elementIdPrefix: string;
  attentionView?: ClusterViewDescriptor;
  attentionCounts?: AttentionCounts;
  attentionAriaLabel?: string;
  resourceViews: ClusterViewDescriptor[];
  resourcesExpanded: boolean;
  buildSidebarItemClassName: SidebarKeyboardControls['buildSidebarItemClassName'];
  isTargetSelected: SidebarKeyboardControls['isTargetSelected'];
  onOverviewSelect: () => void;
  onAttentionSelect: (view: ClusterViewType) => void;
  onResourceViewSelect: (view: ClusterViewType) => void;
  onToggleResources: () => void;
}

const ClusterSidebarSection = (props: ClusterSidebarSectionProps) => (
  <div className="sidebar-section" hidden={props.hidden}>
    <h3>Cluster</h3>
    <div className="cluster-items">
      <button
        type="button"
        className={props.buildSidebarItemClassName(['sidebar-item'], { kind: 'overview' })}
        onClick={props.onOverviewSelect}
        data-sidebar-focusable="true"
        data-sidebar-target-kind="overview"
        tabIndex={-1}
        aria-current={props.isTargetSelected({ kind: 'overview' }) ? 'page' : undefined}
      >
        <ClusterOverviewIcon width={14} height={14} />
        <span>Overview</span>
      </button>
      {props.attentionView ? (
        <button
          type="button"
          className={props.buildSidebarItemClassName(['sidebar-item'], {
            kind: 'cluster-view',
            view: props.attentionView.id,
          })}
          onClick={() => props.onAttentionSelect(props.attentionView?.id ?? 'attention')}
          data-sidebar-focusable="true"
          data-sidebar-target-kind="cluster-view"
          data-sidebar-target-view={props.attentionView.id}
          tabIndex={-1}
          aria-label={props.attentionAriaLabel}
          aria-current={
            props.isTargetSelected({ kind: 'cluster-view', view: props.attentionView.id })
              ? 'page'
              : undefined
          }
        >
          <WarningIcon width={14} height={14} />
          <span className="sidebar-attention-label">{props.attentionView.label}</span>
          <SidebarAttentionBadges counts={props.attentionCounts} />
        </button>
      ) : null}
      <button
        type="button"
        className={props.buildSidebarItemClassName(['sidebar-item', 'header', 'clickable'], {
          kind: 'cluster-toggle',
          id: 'resources',
        })}
        onClick={props.onToggleResources}
        data-sidebar-focusable="true"
        data-sidebar-target-kind="cluster-toggle"
        data-sidebar-target-id="resources"
        tabIndex={-1}
        aria-expanded={props.resourcesExpanded}
        aria-controls={`${props.elementIdPrefix}-sidebar-cluster-resource-views`}
      >
        <ClusterResourcesIcon width={14} height={14} />
        <span>Resources</span>
      </button>
      {props.resourcesExpanded ? (
        <div
          className="sidebar-views"
          id={`${props.elementIdPrefix}-sidebar-cluster-resource-views`}
        >
          {props.resourceViews.map((view) => (
            <button
              type="button"
              key={view.id}
              className={props.buildSidebarItemClassName(['sidebar-item', 'indented'], {
                kind: 'cluster-view',
                view: view.id,
              })}
              onClick={() => props.onResourceViewSelect(view.id)}
              data-sidebar-focusable="true"
              data-sidebar-target-kind="cluster-view"
              data-sidebar-target-view={view.id}
              tabIndex={-1}
              aria-current={
                props.isTargetSelected({ kind: 'cluster-view', view: view.id }) ? 'page' : undefined
              }
            >
              <CategoryIcon width={14} height={14} />
              <span>{view.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  </div>
);

interface NamespaceSidebarSectionProps {
  hidden: boolean;
  shortcut: string;
  permissionDenied: boolean;
  loading: boolean;
  paused: boolean;
  namespaces: NamespaceRow[];
  selectedClusterId?: string;
  selectedNamespaceKey: string | null;
  selectedNamespaceRef: React.RefObject<HTMLButtonElement | null>;
  expandedNamespaceKeys: Set<string>;
  dimInactiveNamespaces: boolean;
  namespaceScope: NamespaceScopeState;
  keyboardActivationRef: React.RefObject<boolean>;
  clearKeyboardPreview: () => void;
  buildSidebarItemClassName: SidebarKeyboardControls['buildSidebarItemClassName'];
  isTargetSelected: SidebarKeyboardControls['isTargetSelected'];
  onNamespaceSelect: (scope: string, clusterId?: string) => void;
  onNamespaceViewSelect: (scope: string, view: NamespaceViewType, clusterId?: string) => void;
}

type NamespaceSidebarContentProps = Omit<NamespaceSidebarSectionProps, 'hidden' | 'shortcut'>;

const NamespaceSidebarContent = (props: NamespaceSidebarContentProps) => {
  if (props.permissionDenied) {
    return (
      <>
        <div className="sidebar-empty-message">
          Insufficient permission to list namespaces. You may manually add the namespaces you are
          allowed to access:
        </div>
        <NamespaceScopeAddRow state={props.namespaceScope} />
      </>
    );
  }
  if (props.loading) {
    return <LoadingSpinner message="Loading namespaces..." />;
  }
  if (props.paused) {
    return <ClusterDataPausedState className="sidebar-empty-message" />;
  }
  return (
    <div className="namespace-items">
      {props.namespaces.map((namespace) => (
        <SidebarNamespaceRow
          key={toNamespaceKey(props.selectedClusterId, namespace.scope ?? namespace.name)}
          namespace={namespace}
          selectedClusterId={props.selectedClusterId}
          selectedNamespaceKey={props.selectedNamespaceKey}
          selectedNamespaceRef={props.selectedNamespaceRef}
          expandedNamespaceKeys={props.expandedNamespaceKeys}
          dimInactiveNamespaces={props.dimInactiveNamespaces}
          namespaceScope={props.namespaceScope}
          keyboardActivationRef={props.keyboardActivationRef}
          clearKeyboardPreview={props.clearKeyboardPreview}
          buildSidebarItemClassName={props.buildSidebarItemClassName}
          isTargetSelected={props.isTargetSelected}
          onNamespaceSelect={props.onNamespaceSelect}
          onNamespaceViewSelect={props.onNamespaceViewSelect}
        />
      ))}
      {props.namespaceScope.scope.length > 0 ? (
        <NamespaceScopeAddRow state={props.namespaceScope} />
      ) : null}
    </div>
  );
};

const NamespaceSidebarSection = (props: NamespaceSidebarSectionProps) => (
  <div className="sidebar-section namespaces-section" hidden={props.hidden}>
    <h3>
      Namespaces{' '}
      <button
        type="button"
        className="sidebar-header-action"
        title={`Select namespace (${props.shortcut})`}
        aria-label="Select namespace"
        onClick={() => eventBus.emit('command-palette:open-namespaces')}
      >
        <SearchIcon width={12} height={12} />
      </button>
    </h3>
    <NamespaceSidebarContent {...props} />
  </div>
);

interface SidebarExpandedContentProps {
  isCollapsed: boolean;
  globalSection: React.ReactNode;
  clusterSection: React.ReactNode;
  namespaceSection: React.ReactNode;
}

const SidebarExpandedContent = ({
  isCollapsed,
  globalSection,
  clusterSection,
  namespaceSection,
}: SidebarExpandedContentProps) => {
  if (isCollapsed) {
    return null;
  }
  return (
    <>
      {globalSection}
      {clusterSection}
      {namespaceSection}
    </>
  );
};

const buildAttentionAriaLabel = (
  attentionView: ClusterViewDescriptor | undefined,
  counts: AttentionCounts | undefined
) => {
  if (!attentionView || !counts) {
    return attentionView?.label;
  }
  const warningLabel = counts.warning === 1 ? 'warning' : 'warnings';
  const errorLabel = counts.error === 1 ? 'error' : 'errors';
  return `${attentionView.label}: ${counts.info} info, ${counts.warning} ${warningLabel}, ${counts.error} ${errorLabel}`;
};

const buildSidebarClassName = (isCollapsed: boolean, isKeyboardNavActive: boolean) =>
  ['sidebar', isCollapsed && 'collapsed', isKeyboardNavActive && 'keyboard-mode']
    .filter(Boolean)
    .join(' ');

const getNamespaceDisplayState = (
  namespaceLoading: boolean,
  permissionDenied: boolean,
  suppressPassiveLoading: boolean,
  hasNamespaceData: boolean
) => {
  const loading = namespaceLoading && !permissionDenied;
  return {
    loading,
    paused: suppressPassiveLoading && !loading && !hasNamespaceData && !permissionDenied,
  };
};

const getSidebarShortcuts = () =>
  isMacPlatform()
    ? { sidebar: '⌘B', namespace: '⇧⌘N' }
    : { sidebar: 'Ctrl+B', namespace: 'Ctrl+Shift+N' };

const optionalClusterId = (clusterId: string | undefined) => clusterId || undefined;

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
  const namespaceScope = useNamespaceScope(optionalClusterId(selectedClusterId));
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
      setExpandedNamespaceKeys((previous) =>
        expandSelectedNamespace(previous, selectedNamespaceKey, exclusiveNamespaces)
      );
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
    if (!lastExpandedNamespaceKey) {
      return;
    }
    const scrollTimer = setTimeout(
      () => scrollExpandedNamespaceIntoView(lastExpandedNamespaceKey),
      200
    );
    return () => clearTimeout(scrollTimer);
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

  const handleGlobalItemSelect = (view: GlobalViewType) => {
    if (!keyboardActivationRef.current) {
      clearKeyboardPreview();
    }
    handleGlobalViewSelect(view);
  };

  const handleOverviewSelect = () => {
    if (!keyboardActivationRef.current) {
      clearKeyboardPreview();
    }
    setPendingSelection({ kind: 'overview' });
    viewState.setViewType('overview');
    viewState.setSidebarSelection({ type: 'overview', value: 'overview' });
  };

  const handleResourceViewSelect = (view: ClusterViewType) => {
    if (!keyboardActivationRef.current) {
      clearKeyboardPreview();
    }
    handleClusterViewSelect(view);
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

  const namespaceDisplayState = getNamespaceDisplayState(
    namespaceLoading,
    namespacesPermissionDenied,
    suppressPassiveLoading,
    hasNamespaceData
  );
  const shortcuts = getSidebarShortcuts();
  const attentionCounts = attentionData?.severityCounts;
  const attentionAriaLabel = buildAttentionAriaLabel(attentionView, attentionCounts);

  return (
    <nav
      className={buildSidebarClassName(isCollapsed, isKeyboardNavActive)}
      style={{ width: `${width}px` }}
      ref={sidebarRef}
      tabIndex={isCollapsed ? -1 : 0}
      data-app-region="sidebar"
    >
      <div className="sidebar-content">
        <SidebarToggle
          isCollapsed={isCollapsed}
          shortcut={shortcuts.sidebar}
          onToggle={viewState.toggleSidebar}
        />
        <SidebarExpandedContent
          isCollapsed={isCollapsed}
          globalSection={
            <GlobalSidebarSection
              show={showGlobalViews}
              buildSidebarItemClassName={buildSidebarItemClassName}
              isTargetSelected={isTargetSelected}
              onSelect={handleGlobalItemSelect}
            />
          }
          clusterSection={
            <ClusterSidebarSection
              hidden={viewState.viewType === 'global'}
              elementIdPrefix={elementIdPrefix}
              attentionView={attentionView}
              attentionCounts={attentionCounts}
              attentionAriaLabel={attentionAriaLabel}
              resourceViews={resourceViews}
              resourcesExpanded={clusterResourcesExpanded}
              buildSidebarItemClassName={buildSidebarItemClassName}
              isTargetSelected={isTargetSelected}
              onOverviewSelect={handleOverviewSelect}
              onAttentionSelect={handleClusterViewSelect}
              onResourceViewSelect={handleResourceViewSelect}
              onToggleResources={() => setClusterResourcesExpanded((previous) => !previous)}
            />
          }
          namespaceSection={
            <NamespaceSidebarSection
              hidden={viewState.viewType === 'global'}
              shortcut={shortcuts.namespace}
              permissionDenied={namespacesPermissionDenied}
              loading={namespaceDisplayState.loading}
              paused={namespaceDisplayState.paused}
              namespaces={namespaces}
              selectedClusterId={selectedClusterId}
              selectedNamespaceKey={selectedNamespaceKey}
              selectedNamespaceRef={selectedNamespaceRef}
              expandedNamespaceKeys={expandedNamespaceKeys}
              dimInactiveNamespaces={dimInactiveNamespaces}
              namespaceScope={namespaceScope}
              keyboardActivationRef={keyboardActivationRef}
              clearKeyboardPreview={clearKeyboardPreview}
              buildSidebarItemClassName={buildSidebarItemClassName}
              isTargetSelected={isTargetSelected}
              onNamespaceSelect={handleNamespaceSelect}
              onNamespaceViewSelect={handleNamespaceViewSelect}
            />
          }
        />
      </div>
    </nav>
  );
}

export default React.memo(Sidebar);
