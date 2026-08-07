/**
 * frontend/src/ui/layout/SidebarKeys.ts
 *
 * Module source for SidebarKeys.
 * Implements SidebarKeys logic for the UI layer.
 */

import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { useKeyboardSurface } from '@ui/shortcuts/surfaces';
import { hasNativeTabHandling, isInputElement, resolveEventElement } from '@ui/shortcuts/utils';
import { type RefObject, useCallback, useEffect, useState } from 'react';
import {
  type ClusterViewType,
  type GlobalViewType,
  type NamespaceViewType,
  parseClusterViewType,
  parseGlobalViewType,
  parseNamespaceViewType,
} from '@/types/navigation/views';
import { focusPreviousRegionBeforeSidebar } from './appFocusRegions';

export type SidebarCursorTarget =
  | { kind: 'overview' }
  | { kind: 'global-view'; view: GlobalViewType }
  | { kind: 'cluster-view'; view: ClusterViewType }
  | { kind: 'namespace-view'; namespace: string; view: NamespaceViewType }
  | { kind: 'cluster-toggle'; id: 'resources' }
  | { kind: 'namespace-toggle'; namespace: string };

export const targetsAreEqual = (a: SidebarCursorTarget | null, b: SidebarCursorTarget | null) => {
  if (!a || !b || a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case 'overview':
      return true;
    case 'global-view':
      return b.kind === 'global-view' && a.view === b.view;
    case 'cluster-view':
      return b.kind === 'cluster-view' && a.view === b.view;
    case 'namespace-view':
      return b.kind === 'namespace-view' && a.view === b.view && a.namespace === b.namespace;
    case 'cluster-toggle':
      return b.kind === 'cluster-toggle' && a.id === b.id;
    case 'namespace-toggle':
      return b.kind === 'namespace-toggle' && a.namespace === b.namespace;
    default:
      return false;
  }
};

const describeClusterViewTarget = (element: HTMLElement): SidebarCursorTarget | null => {
  const view = parseClusterViewType(element.dataset.sidebarTargetView);
  return view ? { kind: 'cluster-view', view } : null;
};

const describeGlobalViewTarget = (element: HTMLElement): SidebarCursorTarget | null => {
  const view = parseGlobalViewType(element.dataset.sidebarTargetView);
  return view ? { kind: 'global-view', view } : null;
};

const describeNamespaceViewTarget = (element: HTMLElement): SidebarCursorTarget | null => {
  const namespace = element.dataset.sidebarTargetNamespace;
  const view = parseNamespaceViewType(element.dataset.sidebarTargetView);
  return namespace && view ? { kind: 'namespace-view', namespace, view } : null;
};

const describeNamespaceToggleTarget = (element: HTMLElement): SidebarCursorTarget | null => {
  const namespace = element.dataset.sidebarTargetNamespace;
  return namespace ? { kind: 'namespace-toggle', namespace } : null;
};

const describeClusterToggleTarget = (element: HTMLElement): SidebarCursorTarget | null => {
  const id = element.dataset.sidebarTargetId;
  return id ? { kind: 'cluster-toggle', id: id as 'resources' } : null;
};

export const describeElementTarget = (element: HTMLElement | null): SidebarCursorTarget | null => {
  if (!element) {
    return null;
  }
  switch (element.dataset.sidebarTargetKind) {
    case 'overview':
      return { kind: 'overview' };
    case 'cluster-view':
      return describeClusterViewTarget(element);
    case 'global-view':
      return describeGlobalViewTarget(element);
    case 'namespace-view':
      return describeNamespaceViewTarget(element);
    case 'namespace-toggle':
      return describeNamespaceToggleTarget(element);
    case 'cluster-toggle':
      return describeClusterToggleTarget(element);
    default:
      return null;
  }
};

export const getFocusableSidebarItems = (sidebar: HTMLElement): HTMLElement[] =>
  Array.from(sidebar.querySelectorAll<HTMLElement>('[data-sidebar-focusable="true"]')).filter(
    (element) => !element.closest('[hidden]')
  );

interface SidebarKeyboardParams {
  sidebarRef: RefObject<HTMLDivElement | null>;
  isCollapsed: boolean;
  cursorPreview: SidebarCursorTarget | null;
  setCursorPreview: (target: SidebarCursorTarget | null) => void;
  pendingSelection: SidebarCursorTarget | null;
  setPendingSelection: (target: SidebarCursorTarget | null) => void;
  keyboardCursorIndexRef: RefObject<number | null>;
  pendingCommitRef: RefObject<SidebarCursorTarget | null>;
  keyboardActivationRef: RefObject<boolean>;
  clearKeyboardPreview: () => void;
  getCurrentSelectionTarget: () => SidebarCursorTarget | null;
}

interface SidebarKeyboardApi {
  buildSidebarItemClassName: (baseClasses: string[], target?: SidebarCursorTarget | null) => string;
  isTargetSelected: (target: SidebarCursorTarget) => boolean;
  focusSelectedSidebarItem: () => void;
  getDisplaySelectionTarget: () => SidebarCursorTarget | null;
  describeTarget: (element: HTMLElement | null) => SidebarCursorTarget | null;
  isKeyboardNavActive: boolean;
}

interface SidebarTabContext {
  sidebar: HTMLElement | null;
  focusPreviousRegion: () => boolean;
  getDisplaySelectionTarget: () => SidebarCursorTarget | null;
  setKeyboardNavActive: (active: boolean) => void;
  setCursorPreview: (target: SidebarCursorTarget | null) => void;
  focusSelectedSidebarItem: () => void;
}

const isFocusInsideSidebar = (sidebar: HTMLElement | null, eventTarget: HTMLElement | null) =>
  Boolean(
    sidebar &&
      ((eventTarget && sidebar.contains(eventTarget)) ||
        (document.activeElement instanceof HTMLElement && sidebar.contains(document.activeElement)))
  );

const handleSidebarTab = (event: KeyboardEvent, context: SidebarTabContext): boolean => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }
  const targetElement = resolveEventElement(event.target);
  if (hasNativeTabHandling(targetElement) || isInputElement(targetElement)) {
    return false;
  }
  if (isFocusInsideSidebar(context.sidebar, targetElement)) {
    return event.shiftKey ? context.focusPreviousRegion() : false;
  }
  if (event.shiftKey || !targetElement?.closest('[data-app-header-last-focusable="true"]')) {
    return false;
  }
  const target = context.getDisplaySelectionTarget();
  context.setKeyboardNavActive(true);
  context.setCursorPreview(target);
  context.focusSelectedSidebarItem();
  return true;
};

interface SidebarNavigationContext {
  sidebar: HTMLElement | null;
  getFocusableItems: () => HTMLElement[];
  getSelectionIndex: () => number;
  focusItemByIndex: (index: number) => HTMLElement | null;
  focusSelectedSidebarItem: () => void;
  setKeyboardNavActive: (active: boolean) => void;
  setCursorPreview: (target: SidebarCursorTarget | null) => void;
  setPendingSelection: (target: SidebarCursorTarget | null) => void;
  keyboardCursorIndexRef: RefObject<number | null>;
  pendingCommitRef: RefObject<SidebarCursorTarget | null>;
  keyboardActivationRef: RefObject<boolean>;
}

interface SidebarNavigationState {
  items: HTMLElement[];
  selectionIndex: number;
  cursorIndex: number;
}

const resolveSidebarCursorIndex = (
  items: HTMLElement[],
  selectionIndex: number,
  cursorIndexRef: RefObject<number | null>
) => {
  const activeElement = document.activeElement as HTMLElement | null;
  const activeIndex = activeElement ? items.indexOf(activeElement) : -1;
  if (activeIndex !== -1) {
    cursorIndexRef.current = activeIndex;
  }
  return cursorIndexRef.current ?? selectionIndex;
};

const prepareSidebarNavigation = (
  event: KeyboardEvent,
  context: SidebarNavigationContext
): SidebarNavigationState | null => {
  if (!context.sidebar?.contains(document.activeElement)) {
    return null;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return null;
  }
  if (isInputElement(resolveEventElement(event.target))) {
    return null;
  }
  const items = context.getFocusableItems();
  if (items.length === 0) {
    return null;
  }
  const selectionIndex = context.getSelectionIndex();
  const cursorIndex = resolveSidebarCursorIndex(
    items,
    selectionIndex,
    context.keyboardCursorIndexRef
  );
  context.setKeyboardNavActive(true);
  return { items, selectionIndex, cursorIndex };
};

const resolveDirectionalOrigin = (
  cursorIndex: number,
  selectionIndex: number,
  itemCount: number,
  delta: number
) => {
  const origin = cursorIndex === -1 ? selectionIndex : cursorIndex;
  if (origin !== -1) {
    return origin;
  }
  return delta > 0 ? -1 : itemCount;
};

const moveSidebarCursor = (
  key: 'ArrowDown' | 'ArrowUp',
  state: SidebarNavigationState,
  context: SidebarNavigationContext
) => {
  const delta = key === 'ArrowDown' ? 1 : -1;
  const origin = resolveDirectionalOrigin(
    state.cursorIndex,
    state.selectionIndex,
    state.items.length,
    delta
  );
  const nextIndex = Math.min(Math.max(origin + delta, 0), state.items.length - 1);
  context.setCursorPreview(describeElementTarget(context.focusItemByIndex(nextIndex)));
  return true;
};

const focusSidebarEdge = (
  key: 'Home' | 'End',
  state: SidebarNavigationState,
  context: SidebarNavigationContext
) => {
  const edgeIndex = key === 'Home' ? 0 : state.items.length - 1;
  context.setCursorPreview(describeElementTarget(context.focusItemByIndex(edgeIndex)));
  return true;
};

const activateSidebarCursor = (
  state: SidebarNavigationState,
  context: SidebarNavigationContext
) => {
  const targetIndex = state.cursorIndex === -1 ? state.selectionIndex : state.cursorIndex;
  const element = state.items[targetIndex];
  if (!element) {
    return true;
  }
  const targetDescriptor = describeElementTarget(element);
  if (targetDescriptor) {
    context.pendingCommitRef.current = targetDescriptor;
    context.setPendingSelection(targetDescriptor);
    context.setCursorPreview(targetDescriptor);
  }
  context.keyboardActivationRef.current = true;
  try {
    element.click();
  } finally {
    context.keyboardActivationRef.current = false;
  }
  return true;
};

const cancelSidebarNavigation = (context: SidebarNavigationContext) => {
  context.pendingCommitRef.current = null;
  context.setCursorPreview(null);
  context.keyboardCursorIndexRef.current = null;
  context.focusSelectedSidebarItem();
  return true;
};

const handleSidebarNavigationKey = (
  key: string,
  state: SidebarNavigationState,
  context: SidebarNavigationContext
): boolean => {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp':
      return moveSidebarCursor(key, state, context);
    case 'Home':
    case 'End':
      return focusSidebarEdge(key, state, context);
    case 'Enter':
    case ' ':
      return activateSidebarCursor(state, context);
    case 'Escape':
      return cancelSidebarNavigation(context);
    default:
      return false;
  }
};

export const useSidebarKeyboardControls = ({
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
}: SidebarKeyboardParams): SidebarKeyboardApi => {
  const [isKeyboardNavActive, setIsKeyboardNavActive] = useState(false);
  const focusPreviousRegion = useCallback(() => focusPreviousRegionBeforeSidebar(), []);

  const getFocusableItems = useCallback((): HTMLElement[] => {
    if (!sidebarRef.current) {
      return [];
    }
    return getFocusableSidebarItems(sidebarRef.current);
  }, [sidebarRef]);

  const findElementIndexForTarget = useCallback(
    (target: SidebarCursorTarget | null) => {
      const items = getFocusableItems();
      if (items.length === 0) {
        return { element: null, index: -1 };
      }
      if (!target) {
        return { element: items[0], index: 0 };
      }
      const idx = items.findIndex((item) => targetsAreEqual(describeElementTarget(item), target));
      if (idx >= 0) {
        return { element: items[idx], index: idx };
      }
      return { element: items[0], index: 0 };
    },
    [getFocusableItems]
  );

  const getSelectionIndex = useCallback(() => {
    const { index } = findElementIndexForTarget(getCurrentSelectionTarget());
    return index;
  }, [findElementIndexForTarget, getCurrentSelectionTarget]);

  const focusTargetElement = useCallback(
    (target: SidebarCursorTarget | null) => {
      const { element, index } = findElementIndexForTarget(target);
      if (element) {
        element.focus();
        keyboardCursorIndexRef.current = index;
      }
      return element;
    },
    [findElementIndexForTarget, keyboardCursorIndexRef]
  );

  const focusSelectedSidebarItem = useCallback(() => {
    if (isCollapsed) {
      return;
    }
    focusTargetElement(getCurrentSelectionTarget());
  }, [focusTargetElement, getCurrentSelectionTarget, isCollapsed]);

  const focusItemByIndex = useCallback(
    (index: number) => {
      const items = getFocusableItems();
      if (index < 0 || index >= items.length) {
        return null;
      }
      const element = items[index];
      element.focus();
      keyboardCursorIndexRef.current = index;
      return element;
    },
    [getFocusableItems, keyboardCursorIndexRef]
  );

  const getDisplaySelectionTarget = useCallback(
    () => pendingSelection ?? getCurrentSelectionTarget(),
    [getCurrentSelectionTarget, pendingSelection]
  );

  const isTargetSelected = useCallback(
    (target: SidebarCursorTarget) => targetsAreEqual(getDisplaySelectionTarget(), target),
    [getDisplaySelectionTarget]
  );

  const isTargetPreviewed = useCallback(
    (target: SidebarCursorTarget) =>
      cursorPreview !== null && targetsAreEqual(cursorPreview, target),
    [cursorPreview]
  );

  const buildSidebarItemClassName = useCallback(
    (baseClasses: string[], target?: SidebarCursorTarget | null) => {
      const classes = [...baseClasses];
      if (target) {
        if (isTargetSelected(target)) {
          classes.push('active');
        }
        if (isTargetPreviewed(target)) {
          classes.push('keyboard-preview');
        }
      }
      return classes.join(' ');
    },
    [isTargetPreviewed, isTargetSelected]
  );

  useEffect(() => {
    if (!isCollapsed && sidebarRef.current?.contains(document.activeElement)) {
      focusSelectedSidebarItem();
    }
    keyboardCursorIndexRef.current = getSelectionIndex();
  }, [
    focusSelectedSidebarItem,
    getSelectionIndex,
    isCollapsed,
    keyboardCursorIndexRef,
    sidebarRef,
  ]);

  useKeyboardSurface({
    kind: 'region',
    rootRef: sidebarRef,
    active: !isCollapsed,
    captureWhenActive: true,
    priority: KeyboardScopePriority.SIDEBAR,
    onKeyDown: (event) => {
      if (event.key === 'Tab') {
        return handleSidebarTab(event, {
          sidebar: sidebarRef.current,
          focusPreviousRegion,
          getDisplaySelectionTarget,
          setKeyboardNavActive: setIsKeyboardNavActive,
          setCursorPreview,
          focusSelectedSidebarItem,
        });
      }
      const context: SidebarNavigationContext = {
        sidebar: sidebarRef.current,
        getFocusableItems,
        getSelectionIndex,
        focusItemByIndex,
        focusSelectedSidebarItem,
        setKeyboardNavActive: setIsKeyboardNavActive,
        setCursorPreview,
        setPendingSelection,
        keyboardCursorIndexRef,
        pendingCommitRef,
        keyboardActivationRef,
      };
      const state = prepareSidebarNavigation(event, context);
      return state ? handleSidebarNavigationKey(event.key, state, context) : false;
    },
  });

  useEffect(() => {
    const container = sidebarRef.current;
    if (!container) {
      return;
    }

    const handleFocusIn = (event: FocusEvent) => {
      if (event.target !== container) {
        return;
      }
      focusSelectedSidebarItem();
    };

    container.addEventListener('focusin', handleFocusIn);
    return () => container.removeEventListener('focusin', handleFocusIn);
  }, [focusSelectedSidebarItem, sidebarRef]);

  useEffect(() => {
    if (isCollapsed) {
      clearKeyboardPreview();
      setIsKeyboardNavActive(false);
      return;
    }
    const container = sidebarRef.current;
    if (!container) {
      return;
    }
    const handleFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (!container.contains(nextTarget)) {
        clearKeyboardPreview();
      }
    };
    container.addEventListener('focusout', handleFocusOut);
    return () => container.removeEventListener('focusout', handleFocusOut);
  }, [clearKeyboardPreview, isCollapsed, sidebarRef]);

  useEffect(() => {
    const container = sidebarRef.current;
    if (!container) {
      return;
    }
    const handlePointerActivity = () => {
      if (isKeyboardNavActive) {
        setIsKeyboardNavActive(false);
      }
      keyboardActivationRef.current = false;
    };
    container.addEventListener('pointermove', handlePointerActivity);
    container.addEventListener('pointerdown', handlePointerActivity);
    return () => {
      container.removeEventListener('pointermove', handlePointerActivity);
      container.removeEventListener('pointerdown', handlePointerActivity);
    };
  }, [isKeyboardNavActive, keyboardActivationRef, sidebarRef]);

  useEffect(() => {
    const current = getCurrentSelectionTarget();
    if (pendingCommitRef.current && targetsAreEqual(pendingCommitRef.current, current)) {
      pendingCommitRef.current = null;
      keyboardCursorIndexRef.current = getSelectionIndex();
    }
    if (pendingSelection && targetsAreEqual(pendingSelection, current)) {
      setPendingSelection(null);
    }
  }, [
    getCurrentSelectionTarget,
    getSelectionIndex,
    keyboardCursorIndexRef,
    pendingCommitRef,
    pendingSelection,
    setPendingSelection,
  ]);

  return {
    buildSidebarItemClassName,
    isTargetSelected,
    focusSelectedSidebarItem,
    getDisplaySelectionTarget,
    describeTarget: describeElementTarget,
    isKeyboardNavActive,
  };
};
