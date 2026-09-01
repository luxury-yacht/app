/**
 * DockablePanel.tsx
 *
 * A React component that renders a right- or bottom-docked panel.
 * Floating is a native-window action owned outside this renderer.
 */

import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { useKeyboardSurface } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { hasNativeTabHandling } from '@ui/shortcuts/utils';
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useOptionalPanelLifecycleGuardRegistry } from '@/core/panel-windows/panelLifecycleGuards';
import { reportOperationalError } from '@/utils/errorHandler';
import { DockablePanelControls } from './DockablePanelControls';
import { DockablePanelHeader } from './DockablePanelHeader';
import { useDockablePanelContext, useDockablePanelHost } from './DockablePanelProvider';
import type { TabInfo } from './DockableTabBar';
import type { PanelSizeConstraints } from './dockablePanelLayout';
import { getContentBounds, getPanelSizeConstraints, PANEL_DEFAULTS } from './dockablePanelLayout';
import { getGroupForPanel, getGroupTabs } from './tabGroupState';
import type { GroupKey, PanelRegistration, TabGroupState } from './tabGroupTypes';
import { useDockablePanelDragResize } from './useDockablePanelDragResize';
import { useDockablePanelMaximize } from './useDockablePanelMaximize';
import {
  clearGroupLeader,
  copyPanelLayoutState,
  type DockPosition,
  type PanelCloseReason,
  registerPanelCloseHandler,
  setGroupLeader,
  unregisterPanelCloseHandler,
  useDockablePanelState,
} from './useDockablePanelState';
import { useWindowBoundsConstraint } from './useDockablePanelWindowBounds';
import './DockablePanel.css';

export type { DockPosition };

interface DockablePanelProps {
  // Unique identifier for this panel instance
  panelId: string;

  // Content to render inside the panel
  children: React.ReactNode;

  // Optional title for the panel header
  title?: string;

  // Optional initial position
  defaultPosition?: DockPosition;
  // Optional initial group key target used during first tab-group sync.
  defaultGroupKey?: GroupKey | 'floating';

  // Optional initial size (defaults to Object Panel dimensions)
  defaultSize?: { width?: number; height?: number };

  // Callbacks
  onClose?: () => void;
  onPositionChange?: (position: DockPosition) => void;

  // Whether the panel is currently open
  isOpen?: boolean;

  // Class names for styling
  className?: string;
  contentClassName?: string;
  // Optional normalized kind class for rendering a compact tab indicator.
  tabKindClass?: string;
  // When enabled, Escape closes the active tab in this dockable group.
  closeActiveTabOnEscape?: boolean;

  // Maximize support
  allowMaximize?: boolean;
  onMaximizeChange?: (isMaximized: boolean) => void;
  maximizeTargetSelector?: string;
  panelRef?: React.Ref<HTMLDivElement>;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) {
    return;
  }
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  try {
    (ref as React.RefObject<T | null>).current = value;
  } catch (error) {
    reportOperationalError(error, { source: 'DockablePanel', action: 'assignRef' });
  }
}

function isKeyboardVisibleElement(element: HTMLElement | null): element is HTMLElement {
  if (!element) {
    return false;
  }

  if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  if (element.closest('[hidden], [aria-hidden="true"], [inert]')) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function getOrderedObjectPanelTabbables(panelRoot: HTMLElement): HTMLElement[] {
  const ordered: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const addAll = (elements: HTMLElement[]) => {
    for (const element of elements) {
      if (seen.has(element)) {
        continue;
      }
      seen.add(element);
      ordered.push(element);
    }
  };

  const groupedPanelTabs = Array.from(
    panelRoot.querySelectorAll<HTMLElement>(
      '.dockable-panel__header .dockable-tab-bar-shell [role="tab"]'
    )
  ).filter(isKeyboardVisibleElement);
  addAll(groupedPanelTabs);

  const activeObjectPanelBody =
    Array.from(
      panelRoot.querySelectorAll<HTMLElement>('.dockable-panel__content > .object-panel-body')
    ).find(isKeyboardVisibleElement) ?? null;

  if (activeObjectPanelBody) {
    const objectTabs = Array.from(
      activeObjectPanelBody.querySelectorAll<HTMLElement>(
        '[aria-label="Object Panel Tabs"] [role="tab"]'
      )
    ).filter(isKeyboardVisibleElement);
    addAll(objectTabs);

    const activeContent = activeObjectPanelBody.querySelector<HTMLElement>('.object-panel-content');
    addAll(getTabbableElements(activeContent));
  }

  const panelControls = Array.from(
    panelRoot.querySelectorAll<HTMLElement>(
      '.dockable-panel__controls .dockable-panel__control-btn'
    )
  ).filter(isKeyboardVisibleElement);
  addAll(panelControls);

  return ordered;
}

type PanelGroupInfo = { tabs: string[]; activeTab: string | null } | null;
type DragResizeControls = ReturnType<typeof useDockablePanelDragResize>;

const resolveDefaultPanelSize = (width: number | undefined, height: number | undefined) => ({
  width: width ?? PANEL_DEFAULTS.DEFAULT_WIDTH,
  height: height ?? PANEL_DEFAULTS.DEFAULT_HEIGHT,
});

interface PanelGroupView {
  groupKey: GroupKey | null;
  groupInfo: PanelGroupInfo;
  leaderPanelId: string;
  activePanelId: string;
  isGroupLeader: boolean;
  isActiveTab: boolean;
  tabCount: number;
}

const resolvePanelGroupView = (
  tabGroups: TabGroupState,
  panelId: string,
  groupLeaders: Map<string, string>
): PanelGroupView => {
  const groupKey = getGroupForPanel(tabGroups, panelId);
  const groupInfo = groupKey ? getGroupTabs(tabGroups, groupKey) : null;
  let leaderPanelId = panelId;
  if (groupKey && groupInfo && groupInfo.tabs.length > 0) {
    const rememberedLeader = groupLeaders.get(groupKey);
    leaderPanelId =
      rememberedLeader && groupInfo.tabs.includes(rememberedLeader)
        ? rememberedLeader
        : groupInfo.tabs[0];
  }
  return {
    groupKey,
    groupInfo,
    leaderPanelId,
    activePanelId: groupInfo?.activeTab ?? panelId,
    isGroupLeader: groupInfo ? leaderPanelId === panelId : true,
    isActiveTab: groupInfo ? groupInfo.activeTab === panelId : true,
    tabCount: groupInfo?.tabs.length ?? 0,
  };
};

const resolvePanelMinimums = (position: DockPosition, constraints: PanelSizeConstraints) => {
  if (position === 'right') {
    return { width: constraints.right.minWidth, height: 0 };
  }
  if (position === 'bottom') {
    return { width: 0, height: constraints.bottom.minHeight };
  }
  return { width: constraints.right.minWidth, height: 0 };
};

const resolveDockFocusTarget = (
  position: DockPosition,
  activePanelId: string,
  tabGroups: TabGroupState,
  groupLeaders: Map<string, string>
) => {
  if (position === 'floating') {
    return activePanelId;
  }
  const targetGroup = getGroupTabs(tabGroups, position);
  if (!targetGroup || targetGroup.tabs.length === 0) {
    return activePanelId;
  }
  const rememberedLeader = groupLeaders.get(position);
  return rememberedLeader && targetGroup.tabs.includes(rememberedLeader)
    ? rememberedLeader
    : targetGroup.tabs[0];
};

const getPanelTabbables = (panelRoot: HTMLElement) =>
  panelRoot.classList.contains('object-panel-dockable')
    ? getOrderedObjectPanelTabbables(panelRoot)
    : getTabbableElements(panelRoot);

const resolveNextPanelTabTarget = (
  tabbables: HTMLElement[],
  target: HTMLElement,
  moveBackward: boolean
): HTMLElement | null => {
  if (tabbables.length === 0) {
    return null;
  }
  const currentIndex = tabbables.findIndex((item) => item === target || item.contains(target));
  if (currentIndex === -1) {
    return moveBackward ? tabbables[tabbables.length - 1] : tabbables[0];
  }
  const delta = moveBackward ? -1 : 1;
  return tabbables[(currentIndex + delta + tabbables.length) % tabbables.length];
};

const handlePanelTabKeyDown = (event: KeyboardEvent, panelRoot: HTMLElement | null): boolean => {
  if (event.key !== 'Tab') {
    return false;
  }
  const target = event.target as HTMLElement | null;
  if (!target || !panelRoot?.contains(target) || hasNativeTabHandling(target)) {
    return false;
  }
  const nextTarget = resolveNextPanelTabTarget(
    getPanelTabbables(panelRoot),
    target,
    event.shiftKey
  );
  if (!nextTarget) {
    return false;
  }
  nextTarget.focus();
  return true;
};

interface DockablePanelContentProps {
  groupInfo: PanelGroupInfo;
  contentRefs: React.MutableRefObject<Map<string, React.MutableRefObject<React.ReactNode>>>;
  registrations: Map<string, PanelRegistration>;
  contentClassName: string;
  children: React.ReactNode;
}

const DockablePanelContent = ({
  groupInfo,
  contentRefs,
  registrations,
  contentClassName,
  children,
}: DockablePanelContentProps) => {
  if (!groupInfo || groupInfo.tabs.length <= 1) {
    return (
      <div className={contentClassName} style={{ flex: 1, minHeight: 0 }}>
        {children}
      </div>
    );
  }
  return groupInfo.tabs.map((tabId) => {
    const tabIsActive = tabId === groupInfo.activeTab;
    return (
      <div
        key={tabId}
        className={registrations.get(tabId)?.contentClassName ?? ''}
        style={{
          display: tabIsActive ? undefined : 'none',
          ...(tabIsActive ? { flex: 1, minHeight: 0 } : {}),
        }}
      >
        {contentRefs.current.get(tabId)?.current}
      </div>
    );
  });
};

interface DockableResizeHandlesProps {
  position: DockPosition;
  size: { width: number; height: number };
  constraints: PanelSizeConstraints;
  isMaximized: boolean;
  onMouseDown: DragResizeControls['handleMouseDownResize'];
  onKeyboardResize: DragResizeControls['handleDockedKeyboardResize'];
}

const DockableResizeHandles = ({
  position,
  size,
  constraints,
  isMaximized,
  onMouseDown,
  onKeyboardResize,
}: DockableResizeHandlesProps) => {
  if (isMaximized) {
    return null;
  }
  if (position === 'right') {
    return (
      <hr
        className="dockable-panel__resize-handle dockable-panel__resize-handle--left"
        onMouseDown={(event) => onMouseDown(event, 'w')}
        onKeyDown={(event) => onKeyboardResize(event, 'right')}
        aria-orientation="vertical"
        aria-label="Resize panel width"
        aria-valuemin={constraints.right.minWidth}
        aria-valuemax={Math.max(constraints.right.minWidth, getContentBounds().width)}
        aria-valuenow={size.width}
        tabIndex={0}
      />
    );
  }
  if (position === 'bottom') {
    return (
      <hr
        className="dockable-panel__resize-handle dockable-panel__resize-handle--top"
        onMouseDown={(event) => onMouseDown(event, 'n')}
        onKeyDown={(event) => onKeyboardResize(event, 'bottom')}
        aria-orientation="horizontal"
        aria-label="Resize panel height"
        aria-valuemin={constraints.bottom.minHeight}
        aria-valuemax={Math.max(constraints.bottom.minHeight, getContentBounds().height)}
        aria-valuenow={size.height}
        tabIndex={0}
      />
    );
  }
  return null;
};

interface DockablePanelLeaderProps {
  activeTitle: string;
  tabs: TabInfo[];
  activeTab: string;
  groupKey: GroupKey | null;
  panelId: string;
  position: DockPosition;
  isMaximized: boolean;
  allowMaximize: boolean;
  groupInfo: PanelGroupInfo;
  contentRefs: React.MutableRefObject<Map<string, React.MutableRefObject<React.ReactNode>>>;
  registrations: Map<string, PanelRegistration>;
  contentClassName: string;
  children: React.ReactNode;
  constraints: PanelSizeConstraints;
  size: { width: number; height: number };
  onTabClick: (panelId: string) => void;
  onDock: (position: DockPosition) => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  onResizeMouseDown: DragResizeControls['handleMouseDownResize'];
  onKeyboardResize: DragResizeControls['handleDockedKeyboardResize'];
  nativeWindowMode: boolean;
}

const DockablePanelLeader = (props: DockablePanelLeaderProps) => (
  <>
    <DockablePanelHeader
      title={props.activeTitle}
      tabs={props.tabs}
      activeTab={props.activeTab}
      onTabClick={props.onTabClick}
      groupKey={props.groupKey ?? props.panelId}
      controls={
        <DockablePanelControls
          position={props.position}
          isMaximized={props.isMaximized}
          allowMaximize={props.allowMaximize}
          onDock={props.onDock}
          onToggleMaximize={props.onToggleMaximize}
          onClose={props.onClose}
          nativeWindowMode={props.nativeWindowMode}
        />
      }
    />
    <div className="dockable-panel__content">
      <DockablePanelContent
        groupInfo={props.groupInfo}
        contentRefs={props.contentRefs}
        registrations={props.registrations}
        contentClassName={props.contentClassName}
      >
        {props.children}
      </DockablePanelContent>
    </div>
    {!props.nativeWindowMode && (
      <DockableResizeHandles
        position={props.position}
        size={props.size}
        constraints={props.constraints}
        isMaximized={props.isMaximized}
        onMouseDown={props.onResizeMouseDown}
        onKeyboardResize={props.onKeyboardResize}
      />
    )}
  </>
);

const DockablePanelInner: React.FC<DockablePanelProps> = (props) => {
  const {
    panelId,
    children,
    title = 'Panel',
    defaultPosition = 'right',
    defaultGroupKey,
    defaultSize: defaultSizeOverride,
    onClose,
    onPositionChange,
    className = '',
    contentClassName = '',
    tabKindClass,
    closeActiveTabOnEscape = false,
    allowMaximize = false,
    onMaximizeChange,
    maximizeTargetSelector = '.content-body',
    panelRef: forwardedPanelRef,
  } = props;
  const defaultSize = useMemo(
    () => resolveDefaultPanelSize(defaultSizeOverride?.width, defaultSizeOverride?.height),
    [defaultSizeOverride?.width, defaultSizeOverride?.height]
  );
  const isControlled = props.isOpen !== undefined;
  const resolvedIsOpen = props.isOpen ?? true;

  // Size constraints are read from CSS custom properties on the panel element.
  // Initial state uses fallback defaults (panel DOM doesn't exist yet on first render).
  const [constraints, setConstraints] = useState<PanelSizeConstraints>(() =>
    getPanelSizeConstraints(null)
  );
  const panelState = useDockablePanelState(panelId);
  const lifecycleGuards = useOptionalPanelLifecycleGuardRegistry();
  const {
    registerPanel,
    unregisterPanel,
    syncPanelGroup,
    removePanelFromGroups,
    tabGroups,
    panelRegistrations,
    switchTab,
    closeTab,
    panelContentRefsMap,
    notifyContentChange,
    subscribeContentChange,
    groupLeaderByKeyRef,
    movePanelBetweenGroupsAndFocus,
    lastFocusedGroupKey,
    setLastFocusedGroupKey,
    requestGroupMove,
    nativeWindowMode,
  } = useDockablePanelContext();
  const panelHostNode = useDockablePanelHost();
  const panelRef = useRef<HTMLDivElement>(null);
  const setPanelRef = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      assignRef(forwardedPanelRef, node);
      // Read size constraints from CSS custom properties once the panel DOM is available.
      if (node) {
        setConstraints(getPanelSizeConstraints(node));
      }
    },
    [forwardedPanelRef]
  );
  const suppressedTabbablesRef = useRef<Map<HTMLElement, string | null>>(new Map());
  // Content ref -- allows the group leader to render this panel's children.
  const contentRef = useRef<React.ReactNode>(children);
  contentRef.current = children;

  useEffect(() => {
    const map = panelContentRefsMap.current;
    map.set(panelId, contentRef);
    return () => {
      map.delete(panelId);
    };
  }, [panelId, panelContentRefsMap]);

  const skipNextControlledSyncRef = useRef(false);

  const { isMaximized, maximizedRect, toggleMaximize } = useDockablePanelMaximize({
    panelState,
    allowMaximize,
    maximizeTargetSelector,
    onMaximizeChange,
  });

  const resolvedMinimums = resolvePanelMinimums(panelState.position, constraints);

  const { isResizing, handleMouseDownResize, handleDockedKeyboardResize } =
    useDockablePanelDragResize({
      panelState,
      safeMinWidth: resolvedMinimums.width,
      safeMinHeight: resolvedMinimums.height,
      isMaximized,
    });

  // Initialize panel state
  useEffect(() => {
    if (!panelState.isInitialized) {
      panelState.initialize({
        position: defaultPosition,
        size: defaultSize,
        isOpen: resolvedIsOpen,
      });
    }
  }, [panelState, defaultPosition, defaultSize, resolvedIsOpen]);

  // Update open state for controlled panels
  useEffect(() => {
    if (!isControlled) {
      return;
    }
    if (skipNextControlledSyncRef.current) {
      skipNextControlledSyncRef.current = false;
      return;
    }
    if (panelState.isInitialized && resolvedIsOpen !== panelState.isOpen) {
      panelState.setOpen(resolvedIsOpen);
    }
  }, [isControlled, resolvedIsOpen, panelState]);

  useEffect(() => {
    const handleExternalClose = (reason: PanelCloseReason) => {
      if (isControlled) {
        skipNextControlledSyncRef.current = true;
      }
      panelState.setOpen(false);
      if (reason === 'dock-conflict' || reason === 'external') {
        onClose?.();
      }
    };

    registerPanelCloseHandler(panelId, handleExternalClose);
    return () => {
      unregisterPanelCloseHandler(panelId, handleExternalClose);
    };
  }, [panelId, panelState, onClose, isControlled]);

  // Store registration props in a ref so the effect below can read current
  // values without re-running on every prop change. We only want to
  // re-register when panelId, isOpen, or position changes.
  const registrationPropsRef = useRef({
    title,
    defaultSize,
    allowMaximize,
    maximizeTargetSelector,
    className,
    contentClassName,
    tabKindClass,
    onClose,
    onPositionChange,
    onMaximizeChange,
    panelRef: forwardedPanelRef,
  });
  registrationPropsRef.current = {
    title,
    defaultSize,
    allowMaximize,
    maximizeTargetSelector,
    className,
    contentClassName,
    tabKindClass,
    onClose,
    onPositionChange,
    onMaximizeChange,
    panelRef: forwardedPanelRef,
  };

  useEffect(() => {
    if (!panelState.isOpen) {
      unregisterPanel(panelId);
      return;
    }
    const rp = registrationPropsRef.current;
    registerPanel({
      panelId,
      title: rp.title,
      position: panelState.position,
      defaultSize: rp.defaultSize,
      allowMaximize: rp.allowMaximize,
      maximizeTargetSelector: rp.maximizeTargetSelector,
      className: rp.className,
      contentClassName: rp.contentClassName,
      tabKindClass: rp.tabKindClass,
      onClose: rp.onClose,
      onPositionChange: rp.onPositionChange,
      onMaximizeChange: rp.onMaximizeChange,
      panelRef: rp.panelRef,
    });
    return () => {
      unregisterPanel(panelId);
    };
  }, [panelId, panelState.isOpen, panelState.position, registerPanel, unregisterPanel]);

  // Keep tab-group membership in sync with open/close and dock position.
  useEffect(() => {
    if (!panelState.isOpen) {
      removePanelFromGroups(panelId);
      return;
    }
    syncPanelGroup(panelId, panelState.position, defaultGroupKey);
  }, [
    panelId,
    panelState.isOpen,
    panelState.position,
    defaultGroupKey,
    syncPanelGroup,
    removePanelFromGroups,
  ]);

  // Handle window resize to keep panels within bounds
  useWindowBoundsConstraint(panelState, {
    minWidth: resolvedMinimums.width,
    isResizing,
    isMaximized,
  });

  // Handle position changes
  useEffect(() => {
    if (onPositionChange && panelState.position) {
      onPositionChange(panelState.position);
    }
  }, [panelState.position, onPositionChange]);

  // -----------------------------------------------------------------------
  // Tab group membership
  // -----------------------------------------------------------------------
  const groupView = useMemo(
    () => resolvePanelGroupView(tabGroups, panelId, groupLeaderByKeyRef.current),
    [tabGroups, panelId, groupLeaderByKeyRef]
  );
  const {
    groupKey,
    groupInfo,
    activePanelId,
    isGroupLeader,
    isActiveTab,
    tabCount: groupTabCount,
  } = groupView;

  // Keep one stable leader per group to avoid container jumps when tab order changes.
  // If leadership transfers, clone layout geometry from prior leader to new leader.
  useLayoutEffect(() => {
    if (!groupKey || !groupInfo || groupInfo.tabs.length === 0) {
      if (groupKey) {
        groupLeaderByKeyRef.current.delete(groupKey);
        clearGroupLeader(groupKey);
      }
      return;
    }
    if (!isGroupLeader) {
      return;
    }
    const previousLeader = groupLeaderByKeyRef.current.get(groupKey);
    if (previousLeader && previousLeader !== panelId) {
      copyPanelLayoutState(previousLeader, panelId);
    }
    groupLeaderByKeyRef.current.set(groupKey, panelId);
    setGroupLeader(groupKey, panelId);
  }, [groupKey, groupInfo, isGroupLeader, panelId, groupLeaderByKeyRef]);

  // Set CSS variables on the shared content container so both the route layout
  // and the portal-mounted dock layer can read the same dock geometry.
  useLayoutEffect(() => {
    if (!panelState.isOpen || isMaximized || !isGroupLeader) {
      return;
    }
    const target = document.querySelector('.content');
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (panelState.position === 'right') {
      target.style.setProperty('--dock-right-offset', `${panelState.size.width}px`);
      document.body.classList.add('dock-right-open');
      return () => {
        document.body.classList.remove('dock-right-open');
        target.style.setProperty('--dock-right-offset', '0px');
      };
    }

    if (panelState.position === 'bottom') {
      target.style.setProperty('--dock-bottom-offset', `${panelState.size.height}px`);
      document.body.classList.add('dock-bottom-open');
      return () => {
        document.body.classList.remove('dock-bottom-open');
        target.style.setProperty('--dock-bottom-offset', '0px');
      };
    }
  }, [
    panelState.isOpen,
    panelState.position,
    panelState.size.width,
    panelState.size.height,
    isMaximized,
    isGroupLeader,
  ]);

  // Content change notification:
  // only the active non-leader tab notifies its own group leader.
  // This preserves streaming updates without cascading across all leaders/groups.
  useEffect(() => {
    if (!isGroupLeader && isActiveTab && groupKey) {
      notifyContentChange(groupKey);
    }
  });

  // Leader subscribes to content changes from non-leaders.
  const [, forceContentUpdate] = React.useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (isGroupLeader && groupTabCount > 1 && groupKey) {
      return subscribeContentChange(groupKey, forceContentUpdate);
    }
  }, [isGroupLeader, groupTabCount, groupKey, subscribeContentChange]);

  // Build tab info for the header.
  const tabsForHeader: TabInfo[] = useMemo(() => {
    if (!groupInfo) {
      return [{ panelId, title, kindClass: tabKindClass }];
    }
    return groupInfo.tabs.map((id) => ({
      panelId: id,
      title: panelRegistrations.get(id)?.title ?? id,
      kindClass: panelRegistrations.get(id)?.tabKindClass,
    }));
  }, [groupInfo, panelRegistrations, panelId, title, tabKindClass]);

  // Title for the header when no tab bar shown (single tab).
  const activeTitle = useMemo(() => {
    if (groupInfo?.activeTab && groupInfo.activeTab !== panelId) {
      return panelRegistrations.get(groupInfo.activeTab)?.title ?? title;
    }
    return title;
  }, [groupInfo, panelRegistrations, panelId, title]);

  const handleTabClick = useCallback(
    (id: string) => {
      if (groupKey) {
        switchTab(groupKey, id);
      }
    },
    [groupKey, switchTab]
  );

  // Handle close -- closes all tabs in the group and the panel itself.
  const handleClose = useCallback(() => {
    const blocker = lifecycleGuards?.firstBlocker(groupInfo?.tabs ?? [panelId]);
    if (blocker) {
      blocker.focus();
      return;
    }
    // Close every other tab in the group first.
    if (groupInfo) {
      for (const tabId of groupInfo.tabs) {
        if (tabId !== panelId) {
          closeTab(tabId);
        }
      }
    }
    // Close this panel (the leader / last remaining tab).
    if (isControlled) {
      skipNextControlledSyncRef.current = true;
    }
    panelState.setOpen(false);
    onClose?.();
  }, [groupInfo, panelId, isControlled, lifecycleGuards, panelState, onClose, closeTab]);

  // Handle docking changes
  const handleDock = useCallback(
    (position: DockPosition) => {
      if (isMaximized) {
        return;
      }

      if (groupKey && requestGroupMove?.(groupKey, position)) {
        return;
      }

      const focusTargetPanelId = resolveDockFocusTarget(
        position,
        activePanelId,
        tabGroups,
        groupLeaderByKeyRef.current
      );
      movePanelBetweenGroupsAndFocus(activePanelId, position, undefined, focusTargetPanelId);
    },
    [
      activePanelId,
      tabGroups,
      groupLeaderByKeyRef,
      movePanelBetweenGroupsAndFocus,
      isMaximized,
      groupKey,
      requestGroupMove,
    ]
  );

  const handleEscapeCloseActiveTab = useCallback(() => {
    if (!closeActiveTabOnEscape) {
      return false;
    }
    closeTab(activePanelId, 'left');
    return true;
  }, [activePanelId, closeActiveTabOnEscape, closeTab]);

  useEffect(() => {
    const panelRoot = panelRef.current;
    if (!panelRoot || !isGroupLeader) {
      return;
    }
    const focusPanel = () => {
      panelState.focus();
      if (groupKey) {
        setLastFocusedGroupKey(groupKey);
      }
    };
    panelRoot.addEventListener('mousedown', focusPanel, true);
    return () => panelRoot.removeEventListener('mousedown', focusPanel, true);
  }, [groupKey, isGroupLeader, panelState, setLastFocusedGroupKey]);

  useKeyboardSurface({
    kind: 'panel',
    rootRef: panelRef,
    active: panelState.isOpen && isGroupLeader,
    priority: KeyboardScopePriority.OBJECT_PANEL,
    captureWhenActive:
      closeActiveTabOnEscape && (!lastFocusedGroupKey || lastFocusedGroupKey === groupKey),
    onEscape: closeActiveTabOnEscape ? handleEscapeCloseActiveTab : undefined,
    onKeyDown: (event) => handlePanelTabKeyDown(event, panelRef.current),
  });

  const restoreSuppressedTabbables = useCallback(() => {
    for (const [element, originalTabIndex] of suppressedTabbablesRef.current.entries()) {
      if (!element.isConnected) {
        continue;
      }
      if (originalTabIndex === null) {
        element.removeAttribute('tabindex');
      } else {
        element.setAttribute('tabindex', originalTabIndex);
      }
    }
    suppressedTabbablesRef.current.clear();
  }, []);

  const suppressPanelTabbables = useCallback(() => {
    const panelRoot = panelRef.current;
    if (!panelRoot || suppressedTabbablesRef.current.size > 0) {
      return;
    }

    for (const element of getTabbableElements(panelRoot)) {
      suppressedTabbablesRef.current.set(element, element.getAttribute('tabindex'));
      element.setAttribute('tabindex', '-1');
    }
  }, []);

  useEffect(() => {
    if (!panelState.isOpen || !isGroupLeader) {
      restoreSuppressedTabbables();
      return;
    }

    const syncPanelTabbables = () => {
      const panelRoot = panelRef.current;
      if (!panelRoot) {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const panelHasFocus = !!activeElement && panelRoot.contains(activeElement);
      if (panelHasFocus) {
        restoreSuppressedTabbables();
      } else {
        suppressPanelTabbables();
      }
    };

    syncPanelTabbables();
    document.addEventListener('focusin', syncPanelTabbables);
    return () => {
      document.removeEventListener('focusin', syncPanelTabbables);
      restoreSuppressedTabbables();
    };
  }, [isGroupLeader, panelState.isOpen, restoreSuppressedTabbables, suppressPanelTabbables]);

  // Memoize panel classes and styles
  const panelClassName = useMemo(() => {
    const renderedPosition = panelState.position === 'floating' ? 'right' : panelState.position;
    const classes = ['dockable-panel', `dockable-panel--${renderedPosition}`, className];

    if (isResizing) {
      classes.push('dockable-panel--resizing');
    }
    if (isMaximized) {
      classes.push('dockable-panel--maximized');
    }
    // Dim panels whose group is not the most recently focused one. Pre-first-focus
    // (lastFocusedGroupKey === null) leaves all panels at full opacity so the
    // app doesn't open in a fully-dimmed state.
    if (
      groupKey !== null &&
      groupKey !== undefined &&
      lastFocusedGroupKey !== null &&
      lastFocusedGroupKey !== undefined &&
      lastFocusedGroupKey !== groupKey
    ) {
      classes.push('dockable-panel--inactive');
    }
    return classes.join(' ');
  }, [panelState.position, className, isResizing, isMaximized, groupKey, lastFocusedGroupKey]);

  const panelStyle = useMemo<React.CSSProperties>(() => {
    const style: React.CSSProperties & Record<string, string | number> = {
      zIndex: panelState.zIndex,
    };
    if (nativeWindowMode) {
      style.inset = '0';
      style.width = '100%';
      style.height = '100%';
      style.transform = 'none';
      return style;
    }
    if (isMaximized) {
      if (maximizedRect) {
        style.top = `${maximizedRect.top}px`;
        style.left = `${maximizedRect.left}px`;
        style.width = `${maximizedRect.width}px`;
        style.height = `${maximizedRect.height}px`;
      } else {
        style.top = '0';
        style.left = '0';
        style.width = '100%';
        style.height = '100%';
      }
      style.right = 'auto';
      style.bottom = 'auto';
      style.transform = 'none';
      style.cursor = 'default';
      style['--dockable-panel-translate-x'] = '0px';
      style['--dockable-panel-translate-y'] = '0px';
      return style;
    }

    // Clamp dimensions and position to keep the panel within the visible content area.
    const content = getContentBounds();

    if (panelState.position === 'right' || panelState.position === 'floating') {
      const maxW = Math.max(constraints.right.minWidth, content.width);
      style.width = `${Math.min(panelState.size.width, maxW)}px`;
    } else if (panelState.position === 'bottom') {
      const maxH = Math.max(constraints.bottom.minHeight, content.height);
      style.height = `${Math.min(panelState.size.height, maxH)}px`;
      style.width = '100%';
    }
    return style;
  }, [
    panelState.position,
    panelState.size,
    panelState.zIndex,
    isMaximized,
    maximizedRect,
    constraints,
    nativeWindowMode,
  ]);

  if (!panelState.isOpen) {
    return null;
  }
  if (!panelHostNode) {
    return null;
  }

  // Always render through a single createPortal so React reuses the DOM node
  // when group leadership transfers between panels, avoiding a visible flash.
  const panelElement = (
    <div
      ref={setPanelRef}
      className={panelClassName}
      data-dockable-group-key={groupKey ?? undefined}
      style={isGroupLeader ? panelStyle : { display: 'none' }}
      role="dialog"
      aria-label={activeTitle}
      aria-modal={false}
      data-group-key={groupKey ?? undefined}
      data-active-panel-id={activePanelId}
    >
      {isGroupLeader ? (
        <DockablePanelLeader
          activeTitle={activeTitle}
          tabs={tabsForHeader}
          activeTab={activePanelId}
          groupKey={groupKey}
          panelId={panelId}
          position={panelState.position}
          isMaximized={isMaximized}
          allowMaximize={allowMaximize}
          groupInfo={groupInfo}
          contentRefs={panelContentRefsMap}
          registrations={panelRegistrations}
          contentClassName={contentClassName}
          constraints={constraints}
          size={panelState.size}
          onTabClick={handleTabClick}
          onDock={handleDock}
          onToggleMaximize={toggleMaximize}
          onClose={handleClose}
          onResizeMouseDown={handleMouseDownResize}
          onKeyboardResize={handleDockedKeyboardResize}
          nativeWindowMode={nativeWindowMode}
        >
          {children}
        </DockablePanelLeader>
      ) : null}
    </div>
  );

  return createPortal(panelElement, panelHostNode);
};

const DockablePanel = memo<DockablePanelProps>((props) => {
  if (!props.panelId) {
    console.warn('DockablePanel: panelId prop is required');
    return null;
  }

  return <DockablePanelInner {...props} />;
});

DockablePanel.displayName = 'DockablePanel';

export default DockablePanel;
