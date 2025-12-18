import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useKeyboardNavigationScope } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import type { NamespaceViewType, ClusterViewType } from '@/types/navigation/views';

export type SidebarCursorTarget =
  | { kind: 'overview' }
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

export const describeElementTarget = (element: HTMLElement | null): SidebarCursorTarget | null => {
  if (!element) {
    return null;
  }
  const kind = element.dataset.sidebarTargetKind;
  if (kind === 'overview') {
    return { kind: 'overview' };
  }
  if (kind === 'cluster-view' && element.dataset.sidebarTargetView) {
    return {
      kind: 'cluster-view',
      view: element.dataset.sidebarTargetView as ClusterViewType,
    };
  }
  if (
    kind === 'namespace-view' &&
    element.dataset.sidebarTargetNamespace &&
    element.dataset.sidebarTargetView
  ) {
    return {
      kind: 'namespace-view',
      namespace: element.dataset.sidebarTargetNamespace,
      view: element.dataset.sidebarTargetView as NamespaceViewType,
    };
  }
  if (kind === 'namespace-toggle' && element.dataset.sidebarTargetNamespace) {
    return {
      kind: 'namespace-toggle',
      namespace: element.dataset.sidebarTargetNamespace,
    };
  }
  if (kind === 'cluster-toggle' && element.dataset.sidebarTargetId) {
    return { kind: 'cluster-toggle', id: element.dataset.sidebarTargetId as 'resources' };
  }
  return null;
};

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
  focusSelectedSidebarItem: () => void;
  getDisplaySelectionTarget: () => SidebarCursorTarget | null;
  describeTarget: (element: HTMLElement | null) => SidebarCursorTarget | null;
  isKeyboardNavActive: boolean;
}

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

  const getFocusableItems = useCallback((): HTMLElement[] => {
    if (!sidebarRef.current) {
      return [];
    }
    return Array.from(
      sidebarRef.current.querySelectorAll<HTMLElement>('[data-sidebar-focusable="true"]')
    );
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

  useKeyboardNavigationScope({
    ref: sidebarRef,
    priority: KeyboardScopePriority.SIDEBAR,
    disabled: isCollapsed,
    onNavigate: () => 'bubble',
    onEnter: () => {
      const target = getDisplaySelectionTarget();
      setIsKeyboardNavActive(true);
      setCursorPreview(target);
      focusSelectedSidebarItem();
    },
  });

  useEffect(() => {
    const container = sidebarRef.current;
    if (!container || isCollapsed) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!container.contains(document.activeElement)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }

      const items = getFocusableItems();
      if (items.length === 0) {
        return;
      }

      const selectionIndex = getSelectionIndex();
      const activeElement = document.activeElement as HTMLElement | null;
      const activeIndex = activeElement ? items.indexOf(activeElement) : -1;
      if (activeIndex !== -1 && keyboardCursorIndexRef.current !== activeIndex) {
        keyboardCursorIndexRef.current = activeIndex;
      }
      const cursorIndex =
        keyboardCursorIndexRef.current !== null ? keyboardCursorIndexRef.current : selectionIndex;

      if (!isKeyboardNavActive) {
        setIsKeyboardNavActive(true);
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const origin = cursorIndex === -1 ? selectionIndex : cursorIndex;
        const start = origin === -1 ? (delta > 0 ? -1 : items.length) : origin;
        const nextIndex = Math.min(Math.max(start + delta, 0), items.length - 1);
        const element = focusItemByIndex(nextIndex);
        const targetDescriptor = describeElementTarget(element);
        setCursorPreview(targetDescriptor);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const edgeIndex = event.key === 'Home' ? 0 : items.length - 1;
        const element = focusItemByIndex(edgeIndex);
        const targetDescriptor = describeElementTarget(element);
        setCursorPreview(targetDescriptor);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const targetIndex = cursorIndex === -1 ? selectionIndex : cursorIndex;
        if (targetIndex >= 0 && targetIndex < items.length) {
          const element = items[targetIndex];
          const targetDescriptor = describeElementTarget(element);
          if (targetDescriptor) {
            pendingCommitRef.current = targetDescriptor;
            setPendingSelection(targetDescriptor);
            setCursorPreview(targetDescriptor);
          }
          keyboardActivationRef.current = true;
          try {
            element.click();
          } finally {
            keyboardActivationRef.current = false;
          }
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        pendingCommitRef.current = null;
        setCursorPreview(null);
        keyboardCursorIndexRef.current = null;
        focusSelectedSidebarItem();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [
    focusItemByIndex,
    focusSelectedSidebarItem,
    getFocusableItems,
    getSelectionIndex,
    isCollapsed,
    isKeyboardNavActive,
    keyboardActivationRef,
    keyboardCursorIndexRef,
    pendingCommitRef,
    setCursorPreview,
    setPendingSelection,
    sidebarRef,
  ]);

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
    focusSelectedSidebarItem,
    getDisplaySelectionTarget,
    describeTarget: describeElementTarget,
    isKeyboardNavActive,
  };
};
