/**
 * useDockablePanelState.ts
 *
 * Hook to manage the state of dockable panels, including position, size, open state, and z-index.
 * Supports floating, right-docked, and bottom-docked positions with independent sizes.
 * Handles initialization, state updates, and conflict resolution when docking panels.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getContentBounds } from './dockablePanelLayout';

export type DockPosition = 'right' | 'bottom' | 'floating';

interface PanelState {
  position: DockPosition;
  // Separate sizes for each position
  floatingSize: { width: number; height: number };
  rightSize: { width: number; height: number };
  bottomSize: { width: number; height: number };
  floatingPosition: { x: number; y: number };
  isOpen: boolean;
  isInitialized: boolean;
  zIndex: number;
}

interface InitializeOptions {
  position?: DockPosition;
  size?: { width?: number; height?: number };
  floatingPosition?: { x?: number; y?: number };
  isOpen?: boolean;
}

// Reasons for panel closure
// 'dock-conflict' indicates the panel was closed due to another panel docking in the same position
// 'external' indicates the panel was closed by an external action (e.g., user clicking close)
export type PanelCloseReason = 'dock-conflict' | 'external';

// Global state store for all panels
const panelStates = new Map<string, PanelState>();
const panelListeners = new Map<string, Set<() => void>>();
let globalZIndex = 1000;
const panelCloseHandlers = new Map<string, (reason: PanelCloseReason) => void>();

// Get or create initial state for a panel
function getInitialState(panelId: string): PanelState {
  if (!panelStates.has(panelId)) {
    // Center the floating panel within the content area by default
    const defaultFloatingWidth = 600;
    const defaultFloatingHeight = 400;
    const content = getContentBounds();
    const centerX = Math.max(100, (content.width - defaultFloatingWidth) / 2);
    const centerY = Math.max(100, (content.height - defaultFloatingHeight) / 2);

    panelStates.set(panelId, {
      position: 'right',
      floatingSize: { width: defaultFloatingWidth, height: defaultFloatingHeight },
      rightSize: { width: 400, height: 300 },
      bottomSize: { width: 400, height: 300 },
      floatingPosition: { x: centerX, y: centerY },
      isOpen: false,
      isInitialized: false,
      zIndex: globalZIndex++,
    });
  }
  return panelStates.get(panelId)!;
}

// Notify all listeners for a panel
function notifyListeners(panelId: string) {
  const listeners = panelListeners.get(panelId);
  if (listeners) {
    listeners.forEach((listener) => listener());
  }
}

// Update state for a panel
function updatePanelState(panelId: string, updates: Partial<PanelState>) {
  const currentState = getInitialState(panelId);
  const newState = { ...currentState, ...updates };
  panelStates.set(panelId, newState);
  notifyListeners(panelId);
}

// Set panel open state with dock conflict handling
function setPanelOpenState(panelId: string, isOpen: boolean) {
  const currentState = getInitialState(panelId);
  if (isOpen && (currentState.position === 'right' || currentState.position === 'bottom')) {
    closeDockedPanels(currentState.position, panelId);
  }
  updatePanelState(panelId, isOpen ? { isOpen: true, zIndex: ++globalZIndex } : { isOpen });
  if (panelId === 'app-logs') {
    import('../../../wailsjs/go/backend/App').then(({ SetLogsPanelVisible }) => {
      SetLogsPanelVisible(isOpen);
    });
  }
}

// Close all panels docked at a specific position, except for an optional panel ID
export function closeDockedPanels(position: DockPosition, exceptPanelId?: string) {
  if (position === 'floating') {
    return;
  }
  panelStates.forEach((state, id) => {
    if (id === exceptPanelId) {
      return;
    }
    if (state.position === position && state.isOpen) {
      const closeHandler = panelCloseHandlers.get(id);
      if (closeHandler) {
        closeHandler('dock-conflict');
        return;
      }
      setPanelOpenState(id, false);
    }
  });
}

export function registerPanelCloseHandler(
  panelId: string,
  handler: (reason: PanelCloseReason) => void
) {
  panelCloseHandlers.set(panelId, handler);
}

export function unregisterPanelCloseHandler(
  panelId: string,
  handler: (reason: PanelCloseReason) => void
) {
  const existing = panelCloseHandlers.get(panelId);
  if (existing === handler) {
    panelCloseHandlers.delete(panelId);
  }
}

export function useDockablePanelState(panelId: string) {
  // Use local state that syncs with global state
  const [localState, setLocalState] = useState<PanelState>(() => getInitialState(panelId));

  // Subscribe to state changes
  useEffect(() => {
    // Update local state on mount with current global state
    setLocalState(getInitialState(panelId));

    const listener = () => {
      // Only update if the state actually changed
      const newState = panelStates.get(panelId);
      if (newState) {
        setLocalState((prevState) => {
          // Check if state actually changed to prevent unnecessary re-renders
          const hasChanged =
            prevState.position !== newState.position ||
            prevState.isOpen !== newState.isOpen ||
            prevState.floatingSize.width !== newState.floatingSize.width ||
            prevState.floatingSize.height !== newState.floatingSize.height ||
            prevState.rightSize.width !== newState.rightSize.width ||
            prevState.rightSize.height !== newState.rightSize.height ||
            prevState.bottomSize.width !== newState.bottomSize.width ||
            prevState.bottomSize.height !== newState.bottomSize.height ||
            prevState.floatingPosition.x !== newState.floatingPosition.x ||
            prevState.floatingPosition.y !== newState.floatingPosition.y ||
            prevState.isInitialized !== newState.isInitialized ||
            prevState.zIndex !== newState.zIndex;

          if (hasChanged) {
            return { ...newState };
          }
          return prevState;
        });
      }
    };

    if (!panelListeners.has(panelId)) {
      panelListeners.set(panelId, new Set());
    }
    panelListeners.get(panelId)!.add(listener);

    return () => {
      const listeners = panelListeners.get(panelId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          panelListeners.delete(panelId);
        }
      }
    };
  }, [panelId]);

  // Initialize panel
  const initialize = useCallback(
    (options: InitializeOptions) => {
      if (!localState.isInitialized) {
        const defaultSize = options.size || {};
        const finalIsOpen = options.isOpen ?? localState.isOpen;
        const targetPosition = options.position ?? localState.position;

        if (finalIsOpen && (targetPosition === 'right' || targetPosition === 'bottom')) {
          closeDockedPanels(targetPosition, panelId);
        }

        updatePanelState(panelId, {
          position: targetPosition,
          // Initialize all position sizes with the provided size or defaults
          floatingSize: {
            width: defaultSize.width ?? localState.floatingSize.width,
            height: defaultSize.height ?? localState.floatingSize.height,
          },
          rightSize: {
            width: defaultSize.width ?? localState.rightSize.width,
            height: localState.rightSize.height, // Height doesn't matter for right dock
          },
          bottomSize: {
            width: localState.bottomSize.width, // Width doesn't matter for bottom dock
            height: defaultSize.height ?? localState.bottomSize.height,
          },
          floatingPosition: {
            x: options.floatingPosition?.x ?? localState.floatingPosition.x,
            y: options.floatingPosition?.y ?? localState.floatingPosition.y,
          },
          isOpen: finalIsOpen,
          isInitialized: true,
        });

        // Sync initial state with backend for app-logs panel
        if (panelId === 'app-logs') {
          import('../../../wailsjs/go/backend/App').then(({ SetLogsPanelVisible }) => {
            SetLogsPanelVisible(finalIsOpen);
          });
        }
      }
    },
    [panelId, localState]
  );

  // Set position
  const setPosition = useCallback(
    (position: DockPosition) => {
      // Just update the position, keeping the floating position intact for when we return to floating
      updatePanelState(panelId, { position });
    },
    [panelId]
  );

  // Set size for current position
  const setSize = useCallback(
    (size: { width: number; height: number }) => {
      const updates: Partial<PanelState> = {};

      // Update the size for the current position only
      switch (localState.position) {
        case 'floating':
          updates.floatingSize = size;
          break;
        case 'right':
          updates.rightSize = { width: size.width, height: localState.rightSize.height };
          break;
        case 'bottom':
          updates.bottomSize = { width: localState.bottomSize.width, height: size.height };
          break;
      }

      updatePanelState(panelId, updates);
    },
    [panelId, localState.position, localState.rightSize.height, localState.bottomSize.width]
  );

  // Get current size based on position
  const getCurrentSize = useCallback(() => {
    switch (localState.position) {
      case 'floating':
        return localState.floatingSize;
      case 'right':
        return localState.rightSize;
      case 'bottom':
        return localState.bottomSize;
      default:
        return localState.floatingSize;
    }
  }, [localState.position, localState.floatingSize, localState.rightSize, localState.bottomSize]);

  // Set floating position with validation
  const setFloatingPosition = useCallback(
    (position: { x: number; y: number }) => {
      // Ensure minimum distance from edges to prevent panel from hiding
      const minDistanceFromEdge = 50;
      const content = getContentBounds();
      const validatedPosition = {
        x: Math.max(0, Math.min(position.x, content.width - 200)),
        y: Math.max(minDistanceFromEdge, Math.min(position.y, content.height - 100)),
      };

      updatePanelState(panelId, { floatingPosition: validatedPosition });
    },
    [panelId]
  );

  // Set open state
  const setOpen = useCallback(
    (isOpen: boolean) => {
      setPanelOpenState(panelId, isOpen);
    },
    [panelId]
  );

  // Toggle open state
  const toggle = useCallback(() => {
    const newState = !localState.isOpen;
    setOpen(newState);
  }, [localState.isOpen, setOpen]);

  // Focus panel (bring to front)
  const focus = useCallback(() => {
    updatePanelState(panelId, { zIndex: ++globalZIndex });
  }, [panelId]);

  // Reset to defaults
  const reset = useCallback(() => {
    const defaultFloatingWidth = 600;
    const defaultFloatingHeight = 400;
    const content = getContentBounds();
    const centerX = Math.max(100, (content.width - defaultFloatingWidth) / 2);
    const centerY = Math.max(100, (content.height - defaultFloatingHeight) / 2);

    updatePanelState(panelId, {
      position: 'right',
      floatingSize: { width: defaultFloatingWidth, height: defaultFloatingHeight },
      rightSize: { width: 400, height: 300 },
      bottomSize: { width: 400, height: 300 },
      floatingPosition: { x: centerX, y: centerY },
      isOpen: false,
      isInitialized: false,
      zIndex: globalZIndex++,
    });
  }, [panelId]);

  // Memoize the return object to prevent unnecessary re-renders
  return useMemo(
    () => ({
      // State
      position: localState.position,
      size: getCurrentSize(), // Get current size based on position
      floatingSize: localState.floatingSize,
      rightSize: localState.rightSize,
      bottomSize: localState.bottomSize,
      floatingPosition: localState.floatingPosition,
      isOpen: localState.isOpen,
      isInitialized: localState.isInitialized,
      zIndex: localState.zIndex,

      // Actions
      initialize,
      setPosition,
      setSize,
      setFloatingPosition,
      setOpen,
      toggle,
      focus,
      reset,
    }),
    [
      localState,
      getCurrentSize,
      initialize,
      setPosition,
      setSize,
      setFloatingPosition,
      setOpen,
      toggle,
      focus,
      reset,
    ]
  );
}

// Export a function to get all panel states (useful for debugging or persistence)
export function getAllPanelStates(): Record<string, PanelState> {
  const states: Record<string, PanelState> = {};
  panelStates.forEach((state, id) => {
    states[id] = { ...state };
  });
  return states;
}

// Export a function to restore panel states (useful for persistence)
export function restorePanelStates(states: Record<string, PanelState>) {
  Object.entries(states).forEach(([id, state]) => {
    panelStates.set(id, { ...state });
    notifyListeners(id);
  });
}
