/**
 * DockablePanelProvider.tsx
 *
 * Context provider for managing dockable panels.
 * Tracks docked panels, provides registration methods, and calculates adjusted dimensions.
 * Manages the host DOM node for rendering floating panels.
 */

import React, { createContext, useContext, useState, useCallback, useLayoutEffect } from 'react';

interface DockablePanelContextValue {
  // Track which panels are docked where
  dockedPanels: {
    right: string[];
    bottom: string[];
  };

  // Register/unregister panels
  registerPanel: (panelId: string, position: 'right' | 'bottom' | 'floating') => void;
  unregisterPanel: (panelId: string) => void;

  // Get adjusted dimensions accounting for other docked panels
  getAdjustedDimensions: () => {
    rightOffset: number;
    bottomOffset: number;
  };
}

const defaultDockablePanelContext: DockablePanelContextValue = {
  dockedPanels: { right: [], bottom: [] },
  registerPanel: () => {},
  unregisterPanel: () => {},
  getAdjustedDimensions: () => ({ rightOffset: 0, bottomOffset: 0 }),
};

const DockablePanelContext = createContext<DockablePanelContextValue | null>(null);
const DockablePanelHostContext = createContext<HTMLElement | null | undefined>(undefined);

export const useDockablePanelContext = () => {
  const context = useContext(DockablePanelContext);
  return context ?? defaultDockablePanelContext;
};

let globalHostNode: HTMLElement | null = null;

/** Resolve the `.content` element that panels are mounted inside. */
function getContentContainer(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const el = document.querySelector('.content');
  return el instanceof HTMLElement ? el : null;
}

function getOrCreateGlobalHost(): HTMLElement | null {
  if (globalHostNode && globalHostNode.parentElement) {
    return globalHostNode;
  }
  const container = getContentContainer();
  if (!container) {
    return null;
  }
  const node = document.createElement('div');
  node.className = 'dockable-panel-layer';
  container.appendChild(node);
  globalHostNode = node;
  return globalHostNode;
}

export const useDockablePanelHost = (): HTMLElement | null => {
  const contextHost = useContext(DockablePanelHostContext);
  if (contextHost !== undefined) {
    return contextHost;
  }
  return getOrCreateGlobalHost();
};

interface DockablePanelProviderProps {
  children: React.ReactNode;
}

export const DockablePanelProvider: React.FC<DockablePanelProviderProps> = ({ children }) => {
  const [dockedPanels, setDockedPanels] = useState({
    right: [] as string[],
    bottom: [] as string[],
  });

  const registerPanel = useCallback(
    (panelId: string, position: 'right' | 'bottom' | 'floating') => {
      setDockedPanels((prev) => {
        const newState = {
          right: prev.right.filter((id) => id !== panelId),
          bottom: prev.bottom.filter((id) => id !== panelId),
        };

        if (position === 'right') {
          newState.right.push(panelId);
        } else if (position === 'bottom') {
          newState.bottom.push(panelId);
        }

        return newState;
      });
    },
    []
  );

  const unregisterPanel = useCallback((panelId: string) => {
    setDockedPanels((prev) => ({
      right: prev.right.filter((id) => id !== panelId),
      bottom: prev.bottom.filter((id) => id !== panelId),
    }));
  }, []);

  const getAdjustedDimensions = useCallback(() => {
    // This could be enhanced to actually calculate the space taken by docked panels
    return {
      rightOffset: dockedPanels.right.length > 0 ? 400 : 0, // Default panel width
      bottomOffset: dockedPanels.bottom.length > 0 ? 300 : 0, // Default panel height
    };
  }, [dockedPanels]);

  const value: DockablePanelContextValue = {
    dockedPanels,
    registerPanel,
    unregisterPanel,
    getAdjustedDimensions,
  };

  const [hostNode, setHostNode] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const container = getContentContainer();
    if (!container) {
      return;
    }
    const node = document.createElement('div');
    node.className = 'dockable-panel-layer';
    container.appendChild(node);
    setHostNode(node);

    return () => {
      if (container.contains(node)) {
        container.removeChild(node);
      }
      if (globalHostNode === node) {
        globalHostNode = null;
      }
      setHostNode(null);
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const target = document.documentElement;
    return () => {
      target.style.removeProperty('--dock-right-offset');
      target.style.removeProperty('--dock-bottom-offset');
    };
  }, []);

  // CSS variables --dock-right-offset and --dock-bottom-offset are set by
  // individual DockablePanel instances based on their actual docked size.
  // The cleanup effect above removes them when the provider unmounts.

  return (
    <DockablePanelContext.Provider value={value}>
      <DockablePanelHostContext.Provider value={hostNode}>
        {children}
      </DockablePanelHostContext.Provider>
    </DockablePanelContext.Provider>
  );
};
