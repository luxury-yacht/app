import { useCallback, useEffect, useRef } from 'react';
import { useDockablePanelState } from '@components/dockable';
import { useObjectPanelState } from '@/core/contexts/ObjectPanelStateContext';
import type { KubernetesObjectReference } from '@/types/view-state';

// Callback ref for closeObjectPanelGlobal to use
let closeCallback: (() => void) | null = null;

/**
 * Hook for controlling the object panel.
 * Combines dockable panel UI state with object panel business logic from context.
 */
export function useObjectPanel() {
  const panelState = useDockablePanelState('object-panel');
  const {
    selectedObject,
    navigationHistory,
    navigationIndex,
    onRowClick,
    onCloseObjectPanel,
    onNavigate,
    showObjectPanel,
  } = useObjectPanelState();

  // Keep the close callback updated for closeObjectPanelGlobal
  const closeRef = useRef(onCloseObjectPanel);
  closeRef.current = onCloseObjectPanel;

  useEffect(() => {
    closeCallback = () => closeRef.current();
    return () => {
      closeCallback = null;
    };
  }, []);

  // Sync context visibility with dockable panel
  useEffect(() => {
    if (showObjectPanel !== panelState.isOpen) {
      panelState.setOpen(showObjectPanel);
    }
  }, [showObjectPanel, panelState]);

  const openWithObject = useCallback(
    (obj: KubernetesObjectReference) => {
      onRowClick(obj);
      panelState.setOpen(true);
    },
    [onRowClick, panelState]
  );

  const close = useCallback(() => {
    onCloseObjectPanel();
    panelState.setOpen(false);
  }, [onCloseObjectPanel, panelState]);

  const navigate = useCallback(
    (index: number) => {
      onNavigate(index);
    },
    [onNavigate]
  );

  return {
    ...panelState,
    objectData: selectedObject,
    navigationHistory,
    navigationIndex,
    openWithObject,
    navigate,
    close,
  };
}

/**
 * Close the object panel from outside of React components.
 * Prefer using the close() method from useObjectPanel() when possible.
 *
 * This is lintignored because it's only used by tests.
 */
/** @lintignore */
export function closeObjectPanelGlobal() {
  closeCallback?.();
}
