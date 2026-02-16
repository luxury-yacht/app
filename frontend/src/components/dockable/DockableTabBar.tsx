/**
 * frontend/src/components/dockable/DockableTabBar.tsx
 *
 * Renders a horizontal tab bar for switching between panels that share
 * a dock position (tab group).
 */

import React, { useCallback, useRef, useLayoutEffect, useState, useEffect } from 'react';
import { useDockablePanelContext } from './DockablePanelProvider';

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
}

/** Horizontal pixels to move the tab strip for each overflow control click. */
const TAB_SCROLL_STEP = 120;
/** Minimum tab-strip width required before overflow controls are useful. */
const MIN_OVERFLOW_HINT_WIDTH = 2;

/**
 * DockableTabBar -- horizontal tab strip for grouped dockable panels.
 * Drag lifecycle and drop commit behavior are provider-owned.
 */
export const DockableTabBar: React.FC<DockableTabBarProps> = ({
  tabs,
  activeTab,
  onTabClick,
  groupKey,
}) => {
  const { dragState, startTabDrag, registerTabBarElement } = useDockablePanelContext();
  const barRef = useRef<HTMLDivElement>(null);
  const previousTabIdsRef = useRef<string[]>(tabs.map((tab) => tab.panelId));
  const previousActiveTabRef = useRef<string | null>(activeTab ?? null);
  const [overflowHint, setOverflowHint] = useState({ left: false, right: false });

  useEffect(() => {
    registerTabBarElement(groupKey, barRef.current);
    return () => {
      registerTabBarElement(groupKey, null);
    };
  }, [groupKey, registerTabBarElement]);

  // Keep edge indicators in sync so users can tell when tab strip is scrollable.
  const updateOverflowHint = useCallback(() => {
    const bar = barRef.current;
    if (!bar) {
      return;
    }
    if (bar.clientWidth <= 0) {
      setOverflowHint((prev) => (prev.left || prev.right ? { left: false, right: false } : prev));
      return;
    }
    if (bar.clientWidth < MIN_OVERFLOW_HINT_WIDTH) {
      setOverflowHint((prev) => (prev.left || prev.right ? { left: false, right: false } : prev));
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

  // Allow header-drag from empty tab-bar space, but keep tab mousedown
  // isolated so tab drag/reorder doesn't also trigger panel header drag.
  const handleBarMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (
      target?.closest('.dockable-tab') ||
      target?.closest('.dockable-tab-bar__overflow-indicator')
    ) {
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

  const handleTabMouseDown = useCallback(
    (e: React.MouseEvent, panelId: string) => {
      // Only handle left mouse button.
      if (e.button !== 0) {
        return;
      }
      startTabDrag(panelId, groupKey, e.clientX, e.clientY);
    },
    [groupKey, startTabDrag]
  );

  // Determine if this bar is the current drop target.
  const isDropTarget = dragState?.dropTarget?.groupKey === groupKey;
  const dropInsertIndex = isDropTarget ? dragState!.dropTarget!.insertIndex : -1;
  const isDragActive = Boolean(dragState);

  const barClassName = `dockable-tab-bar${isDragActive ? ' dockable-tab-bar--drag-active' : ''}${isDropTarget ? ' dockable-tab-bar--drop-target' : ''}${overflowHint.left ? ' dockable-tab-bar--has-left-overflow' : ''}${overflowHint.right ? ' dockable-tab-bar--has-right-overflow' : ''}`;

  return (
    <div className="dockable-tab-bar-shell">
      <div
        ref={barRef}
        className={barClassName}
        data-group-key={groupKey}
        onMouseDown={handleBarMouseDown}
        role="tablist"
        aria-label={`${groupKey} panel tabs`}
      >
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
        {tabs.map((tab, index) => {
          const isActive = tab.panelId === activeTab;
          const isDragging = dragState?.panelId === tab.panelId;
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
        {isDropTarget && dropInsertIndex === tabs.length && (
          <div className="dockable-tab-bar__drop-indicator" data-testid="drop-indicator" />
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
    </div>
  );
};
