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
import type { GroupKey, TabDragState } from './tabGroupTypes';
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

// Track hover suppression across panels so one panel doesn't re-enable hover during another drag.
let hoverSuppressionCount = 0;

function updateGridTableHoverSuppression(shouldSuppress: boolean) {
  if (typeof document === 'undefined') {
    return;
  }
  if (shouldSuppress) {
    if (hoverSuppressionCount === 0) {
      document.body.classList.add('gridtable-disable-hover');
    }
    hoverSuppressionCount += 1;
    return;
  }
  if (hoverSuppressionCount > 0) {
    hoverSuppressionCount -= 1;
    if (hoverSuppressionCount === 0) {
      document.body.classList.remove('gridtable-disable-hover');
    }
  }
}

const DockablePanelInner: React.FC<DockablePanelProps> = (props) => {
  const {
    panelId,
    children,
    title = 'Panel',
    defaultPosition = 'right',
    defaultSize = { width: PANEL_DEFAULTS.DEFAULT_WIDTH, height: PANEL_DEFAULTS.DEFAULT_HEIGHT },
    onClose,
    onPositionChange,
    className = '',
    contentClassName = '',
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
    tabGroups,
    panelRegistrations,
    switchTab,
    closeTab,
    panelContentRefsMap,
    notifyContentChange,
    subscribeContentChange,
    dragState,
    setDragState,
    reorderTabInGroup,
    movePanelBetweenGroups,
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
    handlePanelMouseMove,
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
      onClose: rp.onClose,
      onPositionChange: rp.onPositionChange,
      onMaximizeChange: rp.onMaximizeChange,
      panelRef: rp.panelRef,
    });
    return () => {
      unregisterPanel(panelId);
    };
  }, [panelId, panelState.isOpen, panelState.position, registerPanel, unregisterPanel]);

  // Manage body class to disable hover effects during floating panel drag.
  useEffect(() => {
    const shouldSuppress = panelState.position === 'floating' && isDragging;
    if (shouldSuppress === hoverSuppressionRef.current) {
      return;
    }
    hoverSuppressionRef.current = shouldSuppress;
    updateGridTableHoverSuppression(shouldSuppress);
  }, [isDragging, panelState.position]);

  useEffect(() => {
    return () => {
      if (hoverSuppressionRef.current) {
        hoverSuppressionRef.current = false;
        updateGridTableHoverSuppression(false);
      }
    };
  }, []);

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
  const isGroupLeader = groupInfo ? groupInfo.tabs[0] === panelId : true;
  const groupTabCount = groupInfo?.tabs.length ?? 0;

  // Suppress the slide-in animation when this panel inherits group leadership
  // (e.g. a sibling tab was closed). A brand-new panel won't have a groupKey
  // on its first render (registration happens in useEffect, after render),
  // so groupKey being non-null on first render means we're already in a group
  // and the panel area is already visible — no animation needed.
  const shouldAnimateRef = useRef(groupKey === null);

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

  // Content change notification -- non-leaders notify the leader to re-render
  // when their children change (e.g., logs streaming in while this panel is active tab).
  useEffect(() => {
    if (!isGroupLeader) {
      notifyContentChange();
    }
  });

  // Leader subscribes to content changes from non-leaders.
  const [, forceContentUpdate] = React.useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (isGroupLeader && groupTabCount > 1) {
      return subscribeContentChange(forceContentUpdate);
    }
  }, [isGroupLeader, groupTabCount, subscribeContentChange]);

  // Build tab info for the header.
  const tabsForHeader: TabInfo[] = useMemo(() => {
    if (!groupInfo || groupInfo.tabs.length <= 1) {
      return [{ panelId, title }];
    }
    return groupInfo.tabs.map((id) => ({
      panelId: id,
      title: panelRegistrations.get(id)?.title ?? id,
    }));
  }, [groupInfo, panelRegistrations, panelId, title]);

  // Title for the header when no tab bar shown (single tab).
  const activeTitle = useMemo(() => {
    if (groupInfo?.activeTab && groupInfo.activeTab !== panelId) {
      return panelRegistrations.get(groupInfo.activeTab)?.title ?? title;
    }
    return title;
  }, [groupInfo, panelRegistrations, panelId, title]);

  // -----------------------------------------------------------------------
  // Tab drag callbacks -- forwarded to DockablePanelHeader / DockableTabBar
  // -----------------------------------------------------------------------
  const handleDragStateChange = useCallback(
    (state: TabDragState | null) => {
      setDragState(state);
    },
    [setDragState]
  );

  const handleReorderTab = useCallback(
    (panelId: string, newIndex: number) => {
      if (groupKey) reorderTabInGroup(groupKey, panelId, newIndex);
    },
    [groupKey, reorderTabInGroup]
  );

  const handleMoveToGroup = useCallback(
    (panelId: string, targetGroupKey: string, insertIndex?: number) => {
      // For recognized docked positions or floating group IDs, delegate to the provider.
      movePanelBetweenGroups(panelId, targetGroupKey, insertIndex);
    },
    [movePanelBetweenGroups]
  );

  const handleUndockTab = useCallback(
    (panelId: string, _cursorX: number, _cursorY: number) => {
      // Move the panel to a new floating group.
      movePanelBetweenGroups(panelId, 'floating');
    },
    [movePanelBetweenGroups]
  );

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
      panelState.setPosition(position);
    },
    [panelState, isMaximized]
  );

  // Memoize panel classes and styles
  const panelClassName = useMemo(() => {
    const classes = ['dockable-panel', `dockable-panel--${panelState.position}`, className];
    if (shouldAnimateRef.current) classes.push('dockable-panel--animate-in');
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

  // Non-leaders don't render -- the group leader renders their content.
  if (!isGroupLeader) return null;

  const panelElement = (
    <div
      ref={setPanelRef}
      className={panelClassName}
      style={panelStyle}
      onMouseDown={(e) => {
        panelState.focus();
        // Track which group was most recently interacted with.
        if (groupKey) {
          setLastFocusedGroupKey(groupKey);
        }
        if (isMaximized) {
          return;
        }
        if (panelState.position === 'floating') {
          handleFloatingMouseDown(e);
        }
      }}
      onMouseMove={isMaximized ? undefined : handlePanelMouseMove}
      role="dialog"
      aria-label={activeTitle}
      aria-modal={panelState.position === 'floating'}
    >
      <DockablePanelHeader
        title={activeTitle}
        tabs={tabsForHeader.length > 1 ? tabsForHeader : undefined}
        activeTab={groupInfo?.activeTab ?? null}
        onTabClick={groupKey ? (id) => switchTab(groupKey, id) : undefined}
        groupKey={groupKey ?? panelId}
        onMouseDown={handleHeaderMouseDown}
        dragState={dragState}
        onDragStateChange={handleDragStateChange}
        onReorderTab={handleReorderTab}
        onMoveToGroup={handleMoveToGroup}
        onUndockTab={handleUndockTab}
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
    </div>
  );

  if (!panelHostNode) {
    return null;
  }

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
