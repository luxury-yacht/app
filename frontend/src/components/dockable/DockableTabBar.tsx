/**
 * frontend/src/components/dockable/DockableTabBar.tsx
 *
 * Renders a horizontal tab bar for switching between panels that share
 * a dock position (tab group). Handles click-to-switch, close, and
 * drag-and-drop reordering / undocking / cross-group moving.
 */

import React, { useCallback, useRef, useEffect, useLayoutEffect, useState } from 'react';
import type { TabDragState } from './tabGroupTypes';

/** Describes a single tab in the bar. */
export interface TabInfo {
  panelId: string;
  title: string;
  /** Optional normalized kind class for compact tab indicators. */
  kindClass?: string;
}

interface DockableTabBarProps {
  /** Ordered list of tabs to display. */
  tabs: TabInfo[];
  /** The panelId of the currently active (visible) tab, or null. */
  activeTab: string | null;
  /** Called when the user clicks a tab to switch to it. */
  onTabClick: (panelId: string) => void;
  /** Identifier for the tab group (e.g. "bottom", "right"). */
  groupKey: string;
  // Drag support (optional -- when absent, drag is disabled)
  /** Current drag state from the provider, or null when no drag is in progress. */
  dragState?: TabDragState | null;
  /** Update the drag state in the provider. Pass null to clear. */
  onDragStateChange?: (state: TabDragState | null) => void;
  /** Reorder a tab within this group by moving it to newIndex. */
  onReorderTab?: (panelId: string, newIndex: number) => void;
  /** Move a tab to a different group identified by targetGroupKey. */
  onMoveToGroup?: (panelId: string, targetGroupKey: string, insertIndex?: number) => void;
  /** Undock a tab -- creates a new floating panel near the cursor position. */
  onUndockTab?: (panelId: string, cursorX: number, cursorY: number) => void;
}

/** Distance in pixels the cursor must travel before a drag is initiated. */
const DRAG_THRESHOLD = 5;
/** Vertical distance from the tab bar beyond which a mouseup triggers undock. */
const UNDOCK_THRESHOLD = 40;
/** Horizontal pixels to move the tab strip for each overflow control click. */
const TAB_SCROLL_STEP = 120;

/**
 * Calculate the insertion index for a drop based on cursor X position
 * relative to the tab elements in the bar.
 */
function calculateInsertIndex(
  barElement: HTMLElement,
  cursorX: number,
  tabs: TabInfo[],
  draggedPanelId: string | null
): number {
  const tabElements = barElement.querySelectorAll<HTMLElement>('.dockable-tab');
  let insertIndex = tabs.length;

  for (let i = 0; i < tabElements.length; i++) {
    const rect = tabElements[i].getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (cursorX < midX) {
      insertIndex = i;
      break;
    }
  }

  // When reordering within the same group, adjust the index to account
  // for the dragged tab's removal before insertion.
  if (draggedPanelId) {
    const currentIndex = tabs.findIndex((t) => t.panelId === draggedPanelId);
    if (currentIndex !== -1 && insertIndex > currentIndex) {
      insertIndex = Math.max(0, insertIndex - 1);
    }
  }

  return insertIndex;
}

/**
 * Calculate insertion index from rendered tab elements only.
 * Used for cross-group hover detection where we don't have target group tab data in props.
 */
function calculateInsertIndexFromBarElement(barElement: HTMLElement, cursorX: number): number {
  const tabElements = barElement.querySelectorAll<HTMLElement>('.dockable-tab');
  let insertIndex = tabElements.length;

  for (let i = 0; i < tabElements.length; i++) {
    const rect = tabElements[i].getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (cursorX < midX) {
      insertIndex = i;
      break;
    }
  }

  return insertIndex;
}

/**
 * DockableTabBar -- horizontal tab strip for grouped dockable panels.
 *
 * Tabs are closed via the panel's existing close button (in the panel
 * controls), which closes the active tab or the whole panel if it's
 * the last tab.
 *
 * When drag props are provided, tabs can be reordered by dragging within
 * the same bar, moved to another group by dropping on its tab bar, or
 * undocked to a floating panel by dragging far enough away vertically.
 */
export const DockableTabBar: React.FC<DockableTabBarProps> = ({
  tabs,
  activeTab,
  onTabClick,
  groupKey,
  dragState,
  onDragStateChange,
  onReorderTab,
  onMoveToGroup,
  onUndockTab,
}) => {
  // Ref for the bar element -- used for drop target detection and insert index calculation.
  const barRef = useRef<HTMLDivElement>(null);
  // Ref for tracking drag start position and whether we have crossed the threshold.
  const dragStartRef = useRef<{
    panelId: string;
    startX: number;
    startY: number;
    isDragging: boolean;
  } | null>(null);
  const dragStateRef = useRef<TabDragState | null>(dragState ?? null);
  const previousTabIdsRef = useRef<string[]>(tabs.map((tab) => tab.panelId));
  const previousActiveTabRef = useRef<string | null>(activeTab ?? null);
  const [overflowHint, setOverflowHint] = useState({ left: false, right: false });

  useEffect(() => {
    dragStateRef.current = dragState ?? null;
  }, [dragState]);

  // Keep edge indicators in sync so users can tell when tab strip is scrollable.
  const updateOverflowHint = useCallback(() => {
    const bar = barRef.current;
    if (!bar) {
      return;
    }
    const maxScrollLeft = Math.max(0, bar.scrollWidth - bar.clientWidth);
    const next = {
      left: maxScrollLeft > 1 && bar.scrollLeft > 1,
      right: maxScrollLeft > 1 && bar.scrollLeft < maxScrollLeft - 1,
    };
    setOverflowHint((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  useLayoutEffect(() => {
    updateOverflowHint();
    const bar = barRef.current;
    if (!bar) {
      return;
    }
    const handleScroll = () => updateOverflowHint();
    const handleResize = () => updateOverflowHint();

    bar.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    // Track element size changes (e.g. panel resize) that do not emit window resize.
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateOverflowHint()) : null;
    resizeObserver?.observe(bar);
    return () => {
      bar.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
    };
  }, [tabs, updateOverflowHint]);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const nextTabIds = tabs.map((tab) => tab.panelId);
    const previousTabIds = previousTabIdsRef.current;
    const previousActiveTab = previousActiveTabRef.current;
    const addedTabIds = nextTabIds.filter((panelId) => !previousTabIds.includes(panelId));
    let tabToRevealId: string | null = null;

    if (addedTabIds.length > 0) {
      // Prefer revealing the active tab when it's newly added; otherwise reveal
      // the last added tab so new tabs are always visible on creation.
      tabToRevealId =
        activeTab && addedTabIds.includes(activeTab)
          ? activeTab
          : addedTabIds[addedTabIds.length - 1];
    } else if (activeTab && previousActiveTab !== activeTab && nextTabIds.includes(activeTab)) {
      // Existing tab selection changed -- ensure the newly active tab is visible.
      tabToRevealId = activeTab;
    }

    previousTabIdsRef.current = nextTabIds;
    previousActiveTabRef.current = activeTab ?? null;

    if (!bar || !tabToRevealId) {
      return;
    }

    const tabToReveal = Array.from(bar.querySelectorAll<HTMLElement>('.dockable-tab')).find(
      (tabElement) => tabElement.dataset.panelId === tabToRevealId
    );
    if (!tabToReveal) {
      return;
    }

    if (typeof tabToReveal.scrollIntoView === 'function') {
      tabToReveal.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    updateOverflowHint();
  }, [tabs, activeTab, updateOverflowHint]);

  // Whether drag is enabled (all required callbacks are provided).
  const dragEnabled = !!(onDragStateChange && onReorderTab && onMoveToGroup && onUndockTab);

  // Allow header-drag from empty tab-bar space, but keep tab mousedown
  // isolated so tab drag/reorder doesn't also trigger panel header drag.
  const handleBarMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest('.dockable-tab')) {
      e.stopPropagation();
    }
  }, []);

  // Keep overflow controls clickable without triggering header drag handlers.
  const handleOverflowMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const scrollTabBarBy = useCallback(
    (delta: number) => {
      const bar = barRef.current;
      if (!bar) {
        return;
      }

      if (typeof bar.scrollBy === 'function') {
        bar.scrollBy({ left: delta, behavior: 'smooth' });
        // Smooth scrolling updates asynchronously; re-evaluate after animation start.
        window.setTimeout(() => updateOverflowHint(), 120);
        return;
      }

      bar.scrollLeft += delta;
      updateOverflowHint();
    },
    [updateOverflowHint]
  );

  const handleScrollLeftClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      scrollTabBarBy(-TAB_SCROLL_STEP);
    },
    [scrollTabBarBy]
  );

  const handleScrollRightClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      scrollTabBarBy(TAB_SCROLL_STEP);
    },
    [scrollTabBarBy]
  );

  // -----------------------------------------------------------------------
  // Tab mousedown -- start tracking for potential drag
  // -----------------------------------------------------------------------
  const handleTabMouseDown = useCallback(
    (e: React.MouseEvent, panelId: string) => {
      // Only handle left mouse button.
      if (e.button !== 0) return;
      if (!dragEnabled) return;

      dragStartRef.current = {
        panelId,
        startX: e.clientX,
        startY: e.clientY,
        isDragging: false,
      };
    },
    [dragEnabled]
  );

  // -----------------------------------------------------------------------
  // Global mousemove -- check threshold and update drag state
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!dragEnabled) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) return;

      if (!dragStart.isDragging) {
        // Check if cursor has moved past the drag threshold.
        const dx = e.clientX - dragStart.startX;
        const dy = e.clientY - dragStart.startY;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;

        // Threshold exceeded -- initiate drag.
        dragStart.isDragging = true;
      }

      // Update drag state with current cursor position.
      // Determine if cursor is over this tab bar to set drop target.
      const barRect = barRef.current?.getBoundingClientRect();
      let dropTarget: TabDragState['dropTarget'] = dragStateRef.current?.dropTarget ?? null;

      if (barRect && barRef.current) {
        const isOverBar =
          e.clientX >= barRect.left &&
          e.clientX <= barRect.right &&
          e.clientY >= barRect.top &&
          e.clientY <= barRect.bottom;

        if (isOverBar) {
          const insertIndex = calculateInsertIndex(
            barRef.current,
            e.clientX,
            tabs,
            dragStart.panelId
          );
          dropTarget = { groupKey, insertIndex };
        } else {
          // Resolve cross-group target directly from the hovered tab bar.
          // This avoids race conditions where source-bar mousemove can briefly
          // overwrite a target-bar dropTarget with null between React updates.
          const hoveredElement =
            typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
              ? document.elementFromPoint(e.clientX, e.clientY)
              : null;
          const hoveredBar = hoveredElement?.closest<HTMLElement>('.dockable-tab-bar');
          const hoveredGroupKey = hoveredBar?.dataset.groupKey ?? null;

          if (hoveredBar && hoveredGroupKey && hoveredGroupKey !== groupKey) {
            dropTarget = {
              groupKey: hoveredGroupKey,
              insertIndex: calculateInsertIndexFromBarElement(hoveredBar, e.clientX),
            };
          } else if (dropTarget?.groupKey === groupKey) {
            // Only clear when the current target points at this source bar.
            // Keep other-group targets so cross-group drops remain stable.
            dropTarget = null;
          }
        }
      }

      const nextDragState: TabDragState = {
        panelId: dragStart.panelId,
        sourceGroupKey: groupKey,
        cursorPosition: { x: e.clientX, y: e.clientY },
        dropTarget,
      };
      dragStateRef.current = nextDragState;
      onDragStateChange!(nextDragState);
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [dragEnabled, groupKey, tabs, onDragStateChange]);

  // -----------------------------------------------------------------------
  // Global mouseup -- commit drag action and clean up
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!dragEnabled) return;

    const handleMouseUp = () => {
      const dragStart = dragStartRef.current;
      const currentDragState = dragStateRef.current;
      dragStartRef.current = null;

      if (!dragStart || !dragStart.isDragging || !currentDragState) {
        // No drag in progress -- clear any drag state.
        if (dragStart?.isDragging) {
          dragStateRef.current = null;
          onDragStateChange!(null);
        }
        return;
      }

      const { panelId, sourceGroupKey } = currentDragState;

      if (currentDragState.dropTarget) {
        // Drop on a tab bar.
        const { groupKey: targetGroupKey, insertIndex } = currentDragState.dropTarget;
        if (targetGroupKey === sourceGroupKey) {
          // Reorder within the same group.
          onReorderTab!(panelId, insertIndex);
        } else {
          // Move to a different group.
          onMoveToGroup!(panelId, targetGroupKey, insertIndex);
        }
      } else {
        // No drop target -- check if cursor is far enough from the source bar to undock.
        const barRect = barRef.current?.getBoundingClientRect();
        if (barRect) {
          const verticalDistance = Math.min(
            Math.abs(currentDragState.cursorPosition.y - barRect.top),
            Math.abs(currentDragState.cursorPosition.y - barRect.bottom)
          );
          if (verticalDistance > UNDOCK_THRESHOLD) {
            onUndockTab!(
              panelId,
              currentDragState.cursorPosition.x,
              currentDragState.cursorPosition.y
            );
          }
          // Otherwise: cancel -- cursor is still near the bar.
        }
      }

      // Clear drag state.
      dragStateRef.current = null;
      onDragStateChange!(null);
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [dragEnabled, onDragStateChange, onReorderTab, onMoveToGroup, onUndockTab]);

  // -----------------------------------------------------------------------
  // Drop target detection -- other tab bars update the drop target when
  // a drag from a different bar enters this bar.
  // -----------------------------------------------------------------------
  const handleBarMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Only respond when a drag is active and originates from a different group.
      const currentDragState = dragStateRef.current;
      if (!currentDragState || !onDragStateChange || !barRef.current) return;
      if (currentDragState.sourceGroupKey === groupKey) return;

      const insertIndex = calculateInsertIndex(
        barRef.current,
        e.clientX,
        tabs,
        null // Not a same-group reorder
      );

      // Update the drop target to this bar.
      const nextDragState = {
        ...currentDragState,
        dropTarget: { groupKey, insertIndex },
      };
      dragStateRef.current = nextDragState;
      onDragStateChange(nextDragState);
    },
    [onDragStateChange, groupKey, tabs]
  );

  const handleBarMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      // Set drop target when entering this bar during a cross-group drag.
      const currentDragState = dragStateRef.current;
      if (!currentDragState || !onDragStateChange || !barRef.current) return;
      if (currentDragState.sourceGroupKey === groupKey) return;

      const insertIndex = calculateInsertIndex(barRef.current, e.clientX, tabs, null);

      const nextDragState = {
        ...currentDragState,
        dropTarget: { groupKey, insertIndex },
      };
      dragStateRef.current = nextDragState;
      onDragStateChange(nextDragState);
    },
    [onDragStateChange, groupKey, tabs]
  );

  const handleBarMouseLeave = useCallback(() => {
    // Clear drop target if it was pointing at this bar.
    const currentDragState = dragStateRef.current;
    if (!currentDragState || !onDragStateChange) return;
    if (currentDragState.dropTarget?.groupKey === groupKey) {
      const nextDragState = {
        ...currentDragState,
        dropTarget: null,
      };
      dragStateRef.current = nextDragState;
      onDragStateChange(nextDragState);
    }
  }, [onDragStateChange, groupKey]);

  // Determine if this bar is the current drop target.
  const isDropTarget = dragState?.dropTarget?.groupKey === groupKey;
  const dropInsertIndex = isDropTarget ? dragState!.dropTarget!.insertIndex : -1;
  const isDragActive = Boolean(dragState);

  // Build className for the bar.
  const barClassName = `dockable-tab-bar${isDragActive ? ' dockable-tab-bar--drag-active' : ''}${isDropTarget ? ' dockable-tab-bar--drop-target' : ''}`;

  const shellClassName = `dockable-tab-bar-shell${overflowHint.left ? ' dockable-tab-bar-shell--has-left-overflow' : ''}${overflowHint.right ? ' dockable-tab-bar-shell--has-right-overflow' : ''}`;

  return (
    <div className={shellClassName}>
      <div
        ref={barRef}
        className={barClassName}
        data-group-key={groupKey}
        onMouseDown={handleBarMouseDown}
        onMouseMove={handleBarMouseMove}
        onMouseEnter={handleBarMouseEnter}
        onMouseLeave={handleBarMouseLeave}
        role="tablist"
        aria-label={`${groupKey} panel tabs`}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.panelId === activeTab;
          const isDragging = dragState?.panelId === tab.panelId;

          // Render drop indicator before this tab if this is the insert position.
          const showIndicatorBefore = isDropTarget && dropInsertIndex === index;

          return (
            <React.Fragment key={tab.panelId}>
              {showIndicatorBefore && (
                <div className="dockable-tab-bar__drop-indicator" data-testid="drop-indicator" />
              )}
              <div
                className={`dockable-tab${isActive ? ' dockable-tab--active' : ''}${isDragging ? ' dockable-tab--dragging' : ''}`}
                role="tab"
                aria-selected={isActive}
                data-panel-id={tab.panelId}
                onClick={() => onTabClick(tab.panelId)}
                onMouseDown={(e) => handleTabMouseDown(e, tab.panelId)}
              >
                {tab.kindClass ? (
                  <span
                    className={`dockable-tab__kind-indicator kind-badge ${tab.kindClass}`}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="dockable-tab__label">{tab.title}</span>
              </div>
            </React.Fragment>
          );
        })}
        {/* Drop indicator at the end if inserting after all tabs. */}
        {isDropTarget && dropInsertIndex === tabs.length && (
          <div className="dockable-tab-bar__drop-indicator" data-testid="drop-indicator" />
        )}
      </div>
      {overflowHint.left && (
        <button
          type="button"
          className="dockable-tab-bar__overflow-indicator dockable-tab-bar__overflow-indicator--left"
          aria-label="Scroll tabs left"
          onMouseDown={handleOverflowMouseDown}
          onClick={handleScrollLeftClick}
        >
          <svg
            className="dockable-tab-bar__overflow-icon"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path d="M7.5 2.5L4.5 6L7.5 9.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      )}
      {overflowHint.right && (
        <button
          type="button"
          className="dockable-tab-bar__overflow-indicator dockable-tab-bar__overflow-indicator--right"
          aria-label="Scroll tabs right"
          onMouseDown={handleOverflowMouseDown}
          onClick={handleScrollRightClick}
        >
          <svg
            className="dockable-tab-bar__overflow-icon"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      )}
    </div>
  );
};
