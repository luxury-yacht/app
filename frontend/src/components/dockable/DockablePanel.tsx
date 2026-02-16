/**
 * DockablePanel.tsx
 *
 * A React component that renders a dockable/floatable panel.
 * Handles dragging, resizing, docking, maximizing, and window bounds constraints.
 */

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  memo,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import {
  copyPanelLayoutState,
  registerPanelCloseHandler,
  unregisterPanelCloseHandler,
  useDockablePanelState,
  PanelCloseReason,
} from './useDockablePanelState';
import { useDockablePanelContext, useDockablePanelHost } from './DockablePanelProvider';
import { DockablePanelControls } from './DockablePanelControls';
import { DockablePanelHeader } from './DockablePanelHeader';
import { useDockablePanelDragResize } from './useDockablePanelDragResize';
import { useDockablePanelMaximize } from './useDockablePanelMaximize';
import { useWindowBoundsConstraint } from './useDockablePanelWindowBounds';
import { PANEL_DEFAULTS, getPanelSizeConstraints } from './dockablePanelLayout';
import { getGroupForPanel, getGroupTabs } from './tabGroupState';
import type { PanelSizeConstraints } from './dockablePanelLayout';
import type { TabInfo } from './DockableTabBar';
import type { GroupKey } from './tabGroupTypes';
import type { DockPosition } from './useDockablePanelState';
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

  // Maximize support
  allowMaximize?: boolean;
  onMaximizeChange?: (isMaximized: boolean) => void;
  maximizeTargetSelector?: string;
  panelRef?: React.Ref<HTMLDivElement>;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  try {
    (ref as React.RefObject<T | null>).current = value;
  } catch (error) {
    console.error('DockablePanel: failed to assign ref', error);
  }
}

const DockablePanelInner: React.FC<DockablePanelProps> = (props) => {
  const {
    panelId,
    children,
    title = 'Panel',
    defaultPosition = 'right',
    defaultGroupKey,
    defaultSize = { width: PANEL_DEFAULTS.DEFAULT_WIDTH, height: PANEL_DEFAULTS.DEFAULT_HEIGHT },
    onClose,
    onPositionChange,
    className = '',
    contentClassName = '',
    tabKindClass,
    allowMaximize = false,
    onMaximizeChange,
    maximizeTargetSelector = '.content-body',
    panelRef: forwardedPanelRef,
  } = props;
  const isControlled = typeof props.isOpen !== 'undefined';
  const resolvedIsOpen = props.isOpen ?? true;

  // Size constraints are read from CSS custom properties on the panel element.
  // Initial state uses fallback defaults (panel DOM doesn't exist yet on first render).
  const [constraints, setConstraints] = useState<PanelSizeConstraints>(() =>
    getPanelSizeConstraints(null)
  );
  const panelState = useDockablePanelState(panelId);
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
    updateGridTableHoverSuppression,
    movePanelBetweenGroupsAndFocus,
    setLastFocusedGroupKey,
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
  const hoverSuppressionRef = useRef(false);

  const { isMaximized, maximizedRect, toggleMaximize } = useDockablePanelMaximize({
    panelState,
    allowMaximize,
    maximizeTargetSelector,
    onMaximizeChange,
    panelRef,
  });

  const {
    isDragging,
    isResizing,
    handleHeaderMouseDown,
    handleMouseDownResize,
    handleFloatingMouseDown,
  } = useDockablePanelDragResize({
    panelState,
    panelRef,
    safeMinWidth: constraints.minWidth,
    safeMinHeight: constraints.minHeight,
    safeMaxWidth: constraints.maxWidth,
    safeMaxHeight: constraints.maxHeight,
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
    const currentGroup = getGroupForPanel(tabGroups, panelId);
    const preferredGroupKey = currentGroup ? undefined : defaultGroupKey;
    syncPanelGroup(panelId, panelState.position, preferredGroupKey);
  }, [
    panelId,
    panelState.isOpen,
    panelState.position,
    tabGroups,
    defaultGroupKey,
    syncPanelGroup,
    removePanelFromGroups,
  ]);

  useEffect(() => {
    return () => {
      removePanelFromGroups(panelId);
    };
  }, [panelId, removePanelFromGroups]);

  // Manage body class to disable hover effects during floating panel drag.
  useEffect(() => {
    const shouldSuppress = panelState.position === 'floating' && isDragging;
    if (shouldSuppress === hoverSuppressionRef.current) {
      return;
    }
    hoverSuppressionRef.current = shouldSuppress;
    updateGridTableHoverSuppression(shouldSuppress);
  }, [isDragging, panelState.position, updateGridTableHoverSuppression]);

  useEffect(() => {
    return () => {
      if (hoverSuppressionRef.current) {
        hoverSuppressionRef.current = false;
        updateGridTableHoverSuppression(false);
      }
    };
  }, [updateGridTableHoverSuppression]);

  // Handle window resize to keep panels within bounds
  useWindowBoundsConstraint(panelState, {
    minWidth: constraints.minWidth,
    minHeight: constraints.minHeight,
    isResizing,
    isMaximized,
    panelRef,
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
  const groupKey: GroupKey | null = getGroupForPanel(tabGroups, panelId);
  const groupInfo = groupKey ? getGroupTabs(tabGroups, groupKey) : null;
  const leaderPanelId = useMemo(() => {
    if (!groupKey || !groupInfo || groupInfo.tabs.length === 0) {
      return panelId;
    }
    const rememberedLeader = groupLeaderByKeyRef.current.get(groupKey);
    if (rememberedLeader && groupInfo.tabs.includes(rememberedLeader)) {
      return rememberedLeader;
    }
    return groupInfo.tabs[0];
  }, [groupKey, groupInfo, panelId, groupLeaderByKeyRef]);
  const isGroupLeader = groupInfo ? leaderPanelId === panelId : true;
  const isActiveTab = groupInfo ? groupInfo.activeTab === panelId : true;
  const groupTabCount = groupInfo?.tabs.length ?? 0;

  // Keep one stable leader per group to avoid container jumps when tab order changes.
  // If leadership transfers, clone layout geometry from prior leader to new leader.
  useLayoutEffect(() => {
    if (!groupKey || !groupInfo || groupInfo.tabs.length === 0) {
      if (groupKey) {
        groupLeaderByKeyRef.current.delete(groupKey);
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
  }, [groupKey, groupInfo, isGroupLeader, panelId, groupLeaderByKeyRef]);

  // Set CSS variables so .app-main can shrink the content area for docked panels.
  // Only the group leader sets these -- non-leaders must not touch the CSS variables,
  // otherwise their cleanup resets the offset to 0px causing a visible flicker.
  useLayoutEffect(() => {
    if (!panelState.isOpen || isMaximized || !isGroupLeader) return;

    if (panelState.position === 'right') {
      document.documentElement.style.setProperty(
        '--dock-right-offset',
        `${panelState.size.width}px`
      );
      // Signal that a right-docked panel is open so CSS can apply
      // opening transitions without also transitioning on close.
      document.body.classList.add('dock-right-open');
      return () => {
        document.body.classList.remove('dock-right-open');
        document.documentElement.style.setProperty('--dock-right-offset', '0px');
      };
    }

    if (panelState.position === 'bottom') {
      document.documentElement.style.setProperty(
        '--dock-bottom-offset',
        `${panelState.size.height}px`
      );
      document.body.classList.add('dock-bottom-open');
      return () => {
        document.body.classList.remove('dock-bottom-open');
        document.documentElement.style.setProperty('--dock-bottom-offset', '0px');
      };
    }
  }, [
    panelState.isOpen,
    panelState.position,
    panelState.size.width,
    panelState.size.height,
    isMaximized,
    isGroupLeader,
    groupTabCount,
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

  // Handle close -- closes the active tab. Only closes the panel if it's the last tab.
  const handleClose = useCallback(() => {
    const activeId = groupInfo?.activeTab;
    if (!activeId || groupTabCount <= 1) {
      // Last tab (or single panel) -- close the whole panel.
      if (isControlled) {
        skipNextControlledSyncRef.current = true;
      }
      panelState.setOpen(false);
      onClose?.();
    } else {
      // Multiple tabs -- remove the active tab from the group.
      closeTab(activeId);
    }
  }, [groupInfo, groupTabCount, isControlled, panelState, onClose, closeTab]);

  // Handle docking changes
  const handleDock = useCallback(
    (position: DockPosition) => {
      if (isMaximized) {
        return;
      }

      const activePanelId = groupInfo?.activeTab ?? panelId;
      // Keep the destination group frontmost after moving tabs via panel controls.
      // For docked destinations with existing tabs, the visible container is the
      // stable group leader, not necessarily the moved tab's own panel state.
      let focusTargetPanelId = activePanelId;
      if (position === 'right' || position === 'bottom') {
        const targetGroupInfo = getGroupTabs(tabGroups, position);
        if (targetGroupInfo && targetGroupInfo.tabs.length > 0) {
          const rememberedLeader = groupLeaderByKeyRef.current.get(position);
          focusTargetPanelId =
            rememberedLeader && targetGroupInfo.tabs.includes(rememberedLeader)
              ? rememberedLeader
              : targetGroupInfo.tabs[0];
        }
      }

      if (position === 'floating') {
        movePanelBetweenGroupsAndFocus(activePanelId, 'floating', undefined, focusTargetPanelId);
        return;
      }

      movePanelBetweenGroupsAndFocus(activePanelId, position, undefined, focusTargetPanelId);
    },
    [
      groupInfo,
      panelId,
      tabGroups,
      groupLeaderByKeyRef,
      movePanelBetweenGroupsAndFocus,
      isMaximized,
    ]
  );

  // Memoize panel classes and styles
  const panelClassName = useMemo(() => {
    const classes = ['dockable-panel', `dockable-panel--${panelState.position}`, className];

    if (isDragging) classes.push('dockable-panel--dragging');
    if (isResizing) classes.push('dockable-panel--resizing');
    if (panelState.position === 'floating') classes.push('dockable-panel--floating');
    if (isMaximized) classes.push('dockable-panel--maximized');
    return classes.join(' ');
  }, [panelState.position, className, isDragging, isResizing, isMaximized]);

  const panelStyle = useMemo<React.CSSProperties>(() => {
    const style: React.CSSProperties & Record<string, string | number> = {
      zIndex: panelState.zIndex,
    };
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
    if (panelState.position === 'floating') {
      const roundedX = Math.round(panelState.floatingPosition.x);
      const roundedY = Math.round(panelState.floatingPosition.y);
      style.width = `${panelState.size.width}px`;
      style.height = `${panelState.size.height}px`;
      style.transform = `translate3d(${roundedX}px, ${roundedY}px, 0)`;
      style.top = 0;
      style.left = 0;
      style['--dockable-panel-translate-x'] = `${roundedX}px`;
      style['--dockable-panel-translate-y'] = `${roundedY}px`;
    } else if (panelState.position === 'right') {
      style.width = `${panelState.size.width}px`;
      style.height = '100%';
    } else if (panelState.position === 'bottom') {
      style.height = `${panelState.size.height}px`;
      style.width = '100%';
    }
    return style;
  }, [
    panelState.position,
    panelState.floatingPosition,
    panelState.size,
    panelState.zIndex,
    isMaximized,
    maximizedRect,
  ]);

  if (!panelState.isOpen) return null;
  if (!panelHostNode) return null;

  // Always render through a single createPortal so React reuses the DOM node
  // when group leadership transfers between panels, avoiding a visible flash.
  const panelElement = (
    <div
      ref={setPanelRef}
      className={panelClassName}
      style={isGroupLeader ? panelStyle : { display: 'none' }}
      onMouseDownCapture={
        isGroupLeader
          ? () => {
              // Capture phase ensures focus/tracking runs even when children
              // stop propagation (e.g. tab bar, object panel header).
              panelState.focus();
              if (groupKey) {
                setLastFocusedGroupKey(groupKey);
              }
            }
          : undefined
      }
      onMouseDown={
        isGroupLeader
          ? (e: React.MouseEvent) => {
              if (isMaximized) {
                return;
              }
              if (panelState.position === 'floating') {
                handleFloatingMouseDown(e);
              }
            }
          : undefined
      }
      role="dialog"
      aria-label={activeTitle}
      aria-modal={panelState.position === 'floating'}
    >
      {isGroupLeader && (
        <>
          <DockablePanelHeader
            title={activeTitle}
            tabs={tabsForHeader}
            activeTab={groupInfo?.activeTab ?? panelId}
            onTabClick={(id) => {
              if (groupKey) {
                switchTab(groupKey, id);
              }
            }}
            groupKey={groupKey ?? panelId}
            onMouseDown={handleHeaderMouseDown}
            controls={
              <DockablePanelControls
                position={panelState.position}
                isMaximized={isMaximized}
                allowMaximize={allowMaximize}
                onDock={handleDock}
                onToggleMaximize={toggleMaximize}
                onClose={handleClose}
              />
            }
          />

          <div className="dockable-panel__content" role="main">
            {groupInfo && groupInfo.tabs.length > 1 ? (
              // Multi-tab: render each tab's content, showing only the active one.
              groupInfo.tabs.map((tabId) => {
                const tabIsActive = tabId === groupInfo.activeTab;
                const tabContentRef = panelContentRefsMap.current.get(tabId);
                const tabContentClassName = panelRegistrations.get(tabId)?.contentClassName ?? '';
                return (
                  <div
                    key={tabId}
                    className={tabContentClassName}
                    style={{
                      display: tabIsActive ? undefined : 'none',
                      ...(tabIsActive ? { flex: 1, minHeight: 0 } : {}),
                    }}
                  >
                    {tabContentRef?.current}
                  </div>
                );
              })
            ) : (
              // Single tab or no group: render own content directly.
              <div className={contentClassName} style={{ flex: 1, minHeight: 0 }}>
                {children}
              </div>
            )}
          </div>

          {/* Resize handles */}
          {!isMaximized && panelState.position === 'right' && (
            <div
              className="dockable-panel__resize-handle dockable-panel__resize-handle--left"
              onMouseDown={(e) => handleMouseDownResize(e, 'w')}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panel width"
              tabIndex={0}
            />
          )}
          {!isMaximized && panelState.position === 'bottom' && (
            <div
              className="dockable-panel__resize-handle dockable-panel__resize-handle--top"
              onMouseDown={(e) => handleMouseDownResize(e, 'n')}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize panel height"
              tabIndex={0}
            />
          )}
          {!isMaximized && panelState.position === 'floating' && (
            <>
              {/* Invisible resize zones for floating panels */}
              <div
                className="dockable-panel__resize-zone dockable-panel__resize-zone--top"
                onMouseDown={(e) => handleMouseDownResize(e, 'n')}
              />
              <div
                className="dockable-panel__resize-zone dockable-panel__resize-zone--bottom"
                onMouseDown={(e) => handleMouseDownResize(e, 's')}
              />
              <div
                className="dockable-panel__resize-zone dockable-panel__resize-zone--left"
                onMouseDown={(e) => handleMouseDownResize(e, 'w')}
              />
              <div
                className="dockable-panel__resize-zone dockable-panel__resize-zone--right"
                onMouseDown={(e) => handleMouseDownResize(e, 'e')}
              />
              <div
                className="dockable-panel__resize-zone dockable-panel__resize-zone--top-left"
                onMouseDown={(e) => handleMouseDownResize(e, 'nw')}
              />
              <div
                className="dockable-panel__resize-zone dockable-panel__resize-zone--top-right"
                onMouseDown={(e) => handleMouseDownResize(e, 'ne')}
              />
              <div
                className="dockable-panel__resize-zone dockable-panel__resize-zone--bottom-left"
                onMouseDown={(e) => handleMouseDownResize(e, 'sw')}
              />
              <div
                className="dockable-panel__resize-zone dockable-panel__resize-zone--bottom-right"
                onMouseDown={(e) => handleMouseDownResize(e, 'se')}
              />
            </>
          )}
        </>
      )}
    </div>
  );

  return createPortal(panelElement, panelHostNode);
};

const DockablePanel = memo<DockablePanelProps>((props) => {
  if (!props.panelId) {
    console.error('DockablePanel: panelId prop is required');
    return null;
  }

  return <DockablePanelInner {...props} />;
});

DockablePanel.displayName = 'DockablePanel';

export default DockablePanel;
