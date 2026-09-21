/**
 * DockablePanelGroup.tsx
 *
 * A React component that renders a right- or bottom-docked panel.
 * Floating is a native-window action owned outside this renderer.
 */

import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { useKeyboardSurface } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { hasNativeTabHandling } from '@ui/shortcuts/utils';
import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useOptionalPanelLifecycleGuardRegistry } from '@/core/panel-windows/panelLifecycleGuards';
import { useDockablePanelContext } from './DockablePanelContext';
import { DockablePanelControls } from './DockablePanelControls';
import { DockablePanelHeader } from './DockablePanelHeader';
import type { TabInfo } from './DockableTabBar';
import type { PanelSizeConstraints } from './dockablePanelLayout';
import {
  getContentBounds,
  getDockedPanelExtent,
  getPanelGroupInitialSize,
  getPanelSizeConstraints,
} from './dockablePanelLayout';
import type { DockPosition } from './panelLayoutStore';
import { usePanelLayoutStoreContext } from './panelLayoutStoreContext';
import type { GroupKey } from './tabGroupTypes';
import { useDockableGroupState } from './useDockableGroupState';
import { useDockablePanelDragResize } from './useDockablePanelDragResize';
import { useDockablePanelMaximize } from './useDockablePanelMaximize';
import { useWindowBoundsConstraint } from './useDockablePanelWindowBounds';
import './DockablePanel.css';

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
  for (const tab of groupedPanelTabs) {
    addAll([tab, ...getTabbableElements(tab.closest('.tab-item-shell'))]);
  }

  const activeObjectPanelBody =
    Array.from(
      panelRoot.querySelectorAll<HTMLElement>('.dockable-panel__content > .object-panel-body')
    ).find(isKeyboardVisibleElement) ?? null;

  if (activeObjectPanelBody) {
    const objectTabStrip = activeObjectPanelBody
      .querySelector('[aria-label="Object Panel Tabs"]')
      ?.closest('.tab-strip');
    const objectTabs = Array.from(
      objectTabStrip?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []
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

type DragResizeControls = ReturnType<typeof useDockablePanelDragResize>;

const resolvePanelMinimums = (position: DockPosition, constraints: PanelSizeConstraints) => {
  if (position === 'right') {
    return { width: constraints.right.minWidth, height: 0 };
  }
  if (position === 'bottom') {
    return { width: 0, height: constraints.bottom.minHeight };
  }
  return { width: constraints.right.minWidth, height: 0 };
};

const getPanelTabbables = (panelRoot: HTMLElement) =>
  panelRoot.classList.contains('object-panel-dockable')
    ? getOrderedObjectPanelTabbables(panelRoot)
    : getTabbableElements(panelRoot);

const controlBesideTarget = (controls: HTMLElement[], target: HTMLElement, backwards: boolean) => {
  const ordered = backwards ? [...controls].reverse() : controls;
  const position = backwards ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
  return (
    ordered.find((control) => target.compareDocumentPosition(control) & position) ?? ordered[0]
  );
};

const resolveNextPanelTabTarget = (
  tabbables: HTMLElement[],
  target: HTMLElement,
  moveBackward: boolean
): HTMLElement | null => {
  if (tabbables.length === 0) {
    return null;
  }
  const exactIndex = tabbables.indexOf(target);
  const currentIndex =
    exactIndex >= 0 ? exactIndex : tabbables.findIndex((item) => item.contains(target));
  if (currentIndex === -1) {
    return controlBesideTarget(tabbables, target, moveBackward);
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

export function DockablePanelGroup({
  groupKey,
  tabs,
  activeTab,
}: Readonly<{
  groupKey: GroupKey;
  tabs: string[];
  activeTab: string | null;
}>) {
  const {
    panelRegistrations,
    switchTab,
    closeTab,
    lastFocusedGroupKey,
    setLastFocusedGroupKey,
    requestGroupMove,
    nativeWindowMode,
  } = useDockablePanelContext();
  const layoutStore = usePanelLayoutStoreContext();
  const panelState = useDockableGroupState(groupKey, true);
  const activePanelId = activeTab && tabs.includes(activeTab) ? activeTab : tabs[0];
  const active = panelRegistrations.get(activePanelId);
  const initial = panelRegistrations.get(tabs[0]);
  const {
    className = '',
    allowMaximize = false,
    maximizeTargetSelector = '.content-body',
    onMaximizeChange,
    closeActiveTabOnEscape = false,
  } = active ?? {};
  const activeTitle = active?.title ?? activePanelId;
  const panelRef = useRef<HTMLDivElement>(null);
  const [constraints, setConstraints] = useState<PanelSizeConstraints>(() =>
    getPanelSizeConstraints(null)
  );
  const setPanelRef = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    if (node) {
      setConstraints(getPanelSizeConstraints(node));
    }
  }, []);
  const lifecycleGuards = useOptionalPanelLifecycleGuardRegistry();
  const suppressedTabbablesRef = useRef<Map<HTMLElement, string | null>>(new Map());
  useLayoutEffect(() => {
    layoutStore.initializeGroupLayout(groupKey, getPanelGroupInitialSize(initial));
  }, [layoutStore, groupKey, initial]);
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
  useWindowBoundsConstraint(panelState, {
    minWidth: resolvedMinimums.width,
    isResizing,
    isMaximized,
  });
  // Set CSS variables on the shared content container so both the route layout
  // and the portal-mounted dock layer can read the same dock geometry.
  useLayoutEffect(() => {
    if (isMaximized || nativeWindowMode) {
      return;
    }
    const target = panelRef.current?.parentElement?.parentElement;
    if (!target) {
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
    panelState.position,
    panelState.size.width,
    panelState.size.height,
    isMaximized,
    nativeWindowMode,
  ]);

  const tabsForHeader: TabInfo[] = tabs.map((id) => ({
    panelId: id,
    title: panelRegistrations.get(id)?.title ?? id,
    kindClass: panelRegistrations.get(id)?.tabKindClass,
  }));
  const handleTabClick = useCallback(
    (id: string) => switchTab(groupKey, id),
    [groupKey, switchTab]
  );
  const handleClose = useCallback(() => {
    const blocker = lifecycleGuards?.firstBlocker(tabs);
    if (blocker) {
      blocker.focus();
      return;
    }
    tabs.forEach((id) => {
      closeTab(id);
    });
  }, [tabs, lifecycleGuards, closeTab]);
  // Handle docking changes
  const handleDock = useCallback(
    (position: DockPosition) => {
      if (isMaximized) {
        return;
      }

      if (groupKey) {
        requestGroupMove?.(groupKey, position);
      }
    },
    [isMaximized, groupKey, requestGroupMove]
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
    if (!panelRoot) {
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
  }, [groupKey, panelState, setLastFocusedGroupKey]);

  useKeyboardSurface({
    kind: 'panel',
    rootRef: panelRef,
    active: panelState.isOpen,
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
    if (!panelRoot) {
      return;
    }

    for (const element of getTabbableElements(panelRoot)) {
      suppressedTabbablesRef.current.set(element, element.getAttribute('tabindex'));
      element.setAttribute('tabindex', '-1');
    }
  }, []);

  useEffect(() => {
    if (!panelState.isOpen) {
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
    // Content arrives through tab-owned portals, including lazy loaded tabs.
    const observer = new MutationObserver(syncPanelTabbables);
    if (panelRef.current) {
      observer.observe(panelRef.current, { childList: true, subtree: true });
    }
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', syncPanelTabbables);
      restoreSuppressedTabbables();
    };
  }, [panelState.isOpen, restoreSuppressedTabbables, suppressPanelTabbables]);

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
      return style;
    }

    // Clamp dimensions and position to keep the panel within the visible content area.
    const extent = getDockedPanelExtent(
      panelState.position,
      panelState.size,
      constraints,
      getContentBounds()
    );

    if (panelState.position === 'right' || panelState.position === 'floating') {
      style.width = `${extent}px`;
    } else if (panelState.position === 'bottom') {
      style.height = `${extent}px`;
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

  return (
    <div
      ref={setPanelRef}
      className={panelClassName}
      style={panelStyle}
      data-dockable-group-key={groupKey}
      data-group-key={groupKey}
      data-active-panel-id={activePanelId}
      role="dialog"
      aria-label={activeTitle}
      aria-modal={false}
    >
      <DockablePanelHeader
        title={activeTitle}
        tabs={tabsForHeader}
        activeTab={activePanelId}
        onTabClick={handleTabClick}
        groupKey={groupKey}
        controls={
          <DockablePanelControls
            position={panelState.position}
            isMaximized={isMaximized}
            allowMaximize={allowMaximize}
            onDock={handleDock}
            onToggleMaximize={toggleMaximize}
            onClose={handleClose}
            nativeWindowMode={nativeWindowMode}
          />
        }
      />
      <div className="dockable-panel__content">
        {tabs.map((id) => {
          const registration = panelRegistrations.get(id);
          return (
            <div
              key={id}
              ref={registration?.contentHostRef}
              className={`dockable-panel__tab-content ${registration?.contentClassName ?? ''}`}
              hidden={id !== activePanelId}
              inert={id !== activePanelId}
              aria-hidden={id !== activePanelId}
            />
          );
        })}
      </div>
      {!nativeWindowMode && (
        <DockableResizeHandles
          position={panelState.position}
          size={panelState.size}
          constraints={constraints}
          isMaximized={isMaximized}
          onMouseDown={handleMouseDownResize}
          onKeyboardResize={handleDockedKeyboardResize}
        />
      )}
    </div>
  );
}
