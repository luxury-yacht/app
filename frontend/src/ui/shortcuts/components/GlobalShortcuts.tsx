/**
 * frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx
 *
 * UI component for GlobalShortcuts.
 * Handles rendering and interactions for the shared components.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useShortcut } from '../hooks';
import { ShortcutHelpModal } from './ShortcutHelpModal';
import { KeyCodes } from '../constants';
import { isMacPlatform } from '@/utils/platform';
import { useZoom } from '@core/contexts/ZoomContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  getClusterTabOrder,
  hydrateClusterTabOrder,
  subscribeClusterTabOrder,
} from '@core/persistence/clusterTabOrder';
import { EventsOn, EventsOff, Quit } from '@wailsjs/runtime/runtime';

interface GlobalShortcutsProps {
  onToggleSidebar?: () => void;
  onToggleAppLogsPanel?: () => void;
  onToggleSettings?: () => void;
  onToggleObjectDiff?: () => void;
  onCreateResource?: () => void;
  onRefresh?: () => void;
  onToggleDiagnostics?: () => void;
  isAppLogsPanelOpen?: boolean;
  isObjectPanelOpen?: boolean;
  isSettingsOpen?: boolean;
}

export function GlobalShortcuts({
  onToggleSidebar,
  onToggleAppLogsPanel,
  onToggleSettings,
  onToggleObjectDiff,
  onCreateResource,
  onRefresh,
  onToggleDiagnostics,
  isAppLogsPanelOpen,
  isObjectPanelOpen,
  isSettingsOpen,
}: GlobalShortcutsProps) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isModalAnimating, setIsModalAnimating] = useState(false);
  const { selectedKubeconfig, selectedKubeconfigs, setSelectedKubeconfigs, setActiveKubeconfig } =
    useKubeconfig();
  const { zoomIn, zoomOut, resetZoom } = useZoom();
  const [clusterTabOrder, setClusterTabOrder] = useState<string[]>(() => getClusterTabOrder());

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      const order = await hydrateClusterTabOrder();
      if (active) {
        setClusterTabOrder(order);
      }
    };
    void hydrate();
    const unsubscribe = subscribeClusterTabOrder((order) => {
      setClusterTabOrder(order);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Toggle help overlay - only if no other modal is open or animating
  const toggleHelp = useCallback(() => {
    if (!isSettingsOpen && !isModalAnimating) {
      setIsHelpOpen((prev) => !prev);
    }
  }, [isSettingsOpen, isModalAnimating]);

  // Memoize all handlers to prevent re-registration
  const handleToggleSidebar = useCallback(() => {
    onToggleSidebar?.();
  }, [onToggleSidebar]);

  const handleToggleAppLogsPanel = useCallback(() => {
    onToggleAppLogsPanel?.();
  }, [onToggleAppLogsPanel]);

  const handleToggleSettings = useCallback(() => {
    // Only toggle settings if help modal isn't open or animating
    if (!isHelpOpen && !isModalAnimating) {
      onToggleSettings?.();
    }
  }, [onToggleSettings, isHelpOpen, isModalAnimating]);

  const handleToggleObjectDiff = useCallback(() => {
    if (!isHelpOpen && !isModalAnimating) {
      onToggleObjectDiff?.();
    }
  }, [onToggleObjectDiff, isHelpOpen, isModalAnimating]);

  const handleCreateResource = useCallback(() => {
    if (!isHelpOpen && !isModalAnimating) {
      onCreateResource?.();
    }
  }, [onCreateResource, isHelpOpen, isModalAnimating]);

  const handleToggleDiagnostics = useCallback(() => {
    onToggleDiagnostics?.();
  }, [onToggleDiagnostics]);

  const handleRefresh = useCallback(
    (e?: KeyboardEvent) => {
      e?.preventDefault();
      onRefresh?.();
      return false;
    },
    [onRefresh]
  );

  const handleCloseClusterTab = useCallback(() => {
    if (!selectedKubeconfig) {
      return;
    }
    // Close the active cluster tab by removing it from the selection list.
    const nextSelections = selectedKubeconfigs.filter((config) => config !== selectedKubeconfig);
    if (nextSelections.length === selectedKubeconfigs.length) {
      return;
    }
    void setSelectedKubeconfigs(nextSelections);
  }, [selectedKubeconfig, selectedKubeconfigs, setSelectedKubeconfigs]);

  const orderedClusterSelections = useMemo(() => {
    // Follow the persisted tab order to mirror the visible cluster tabs.
    const tabEntries = selectedKubeconfigs.map((selection) => ({
      selection,
      id: selection,
    }));
    const selectionOrderIds = tabEntries.map((entry) => entry.id);
    const persisted = clusterTabOrder.filter((id) => selectionOrderIds.includes(id));
    const missing = selectionOrderIds.filter((id) => !persisted.includes(id));
    const mergedOrder = [...persisted, ...missing];
    const selectionById = new Map(tabEntries.map((entry) => [entry.id, entry.selection]));
    return mergedOrder
      .map((id) => selectionById.get(id))
      .filter((selection): selection is string => Boolean(selection));
  }, [clusterTabOrder, selectedKubeconfigs]);

  const handleSwitchClusterTab = useCallback(
    (direction: 'prev' | 'next') => {
      if (!selectedKubeconfig || orderedClusterSelections.length < 2) {
        return;
      }
      const currentIndex = orderedClusterSelections.indexOf(selectedKubeconfig);
      if (currentIndex < 0) {
        return;
      }
      const nextIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
      const nextSelection = orderedClusterSelections[nextIndex];
      if (!nextSelection) {
        return;
      }
      setActiveKubeconfig(nextSelection);
    },
    [orderedClusterSelections, selectedKubeconfig, setActiveKubeconfig]
  );

  const macPlatform = isMacPlatform();

  // Use refs to avoid stale closures in the Escape handler
  const isHelpOpenRef = useRef(isHelpOpen);
  const isSettingsOpenRef = useRef(isSettingsOpen);
  const isAppLogsPanelOpenRef = useRef(isAppLogsPanelOpen);
  const isObjectPanelOpenRef = useRef(isObjectPanelOpen);

  useEffect(() => {
    isHelpOpenRef.current = isHelpOpen;
    isSettingsOpenRef.current = isSettingsOpen;
    isAppLogsPanelOpenRef.current = isAppLogsPanelOpen;
    isObjectPanelOpenRef.current = isObjectPanelOpen;
  }, [isHelpOpen, isSettingsOpen, isAppLogsPanelOpen, isObjectPanelOpen]);

  // Track when modals are animating to prevent opening others
  useEffect(() => {
    // When a modal starts closing, set animating flag
    if (!isHelpOpen && isHelpOpenRef.current) {
      setIsModalAnimating(true);
      const timer = setTimeout(() => {
        setIsModalAnimating(false);
      }, 200); // Match animation duration
      return () => clearTimeout(timer);
    }
  }, [isHelpOpen]);

  useEffect(() => {
    // When settings modal starts closing, set animating flag
    if (!isSettingsOpen && isSettingsOpenRef.current) {
      setIsModalAnimating(true);
      const timer = setTimeout(() => {
        setIsModalAnimating(false);
      }, 200); // Match animation duration
      return () => clearTimeout(timer);
    }
  }, [isSettingsOpen]);

  const handleEscape = useCallback(() => {
    // Check refs for current state - priority order:
    // 1. Help overlay
    // 2. Settings modal
    // 3. Application Logs Panel (closes before object panel when both are open)
    // 4. Object panel
    if (isHelpOpenRef.current) {
      setIsHelpOpen(false);
    } else if (isSettingsOpenRef.current && onToggleSettings) {
      onToggleSettings(); // This will toggle it off
    } else if (isAppLogsPanelOpenRef.current && onToggleAppLogsPanel) {
      onToggleAppLogsPanel();
    } else if (isObjectPanelOpenRef.current) {
      // Object panel has its own ESC handler now
    }
  }, [onToggleSettings, onToggleAppLogsPanel]);

  // Register all shortcuts individually to avoid hooks in loops
  useShortcut({
    key: '?',
    modifiers: { shift: true },
    handler: toggleHelp,
    description: 'Show keyboard shortcuts help',
    category: 'Global',
  });

  useShortcut({
    key: 'b',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleToggleSidebar,
    description: 'Toggle sidebar',
    category: 'Global',
    enabled: !!onToggleSidebar,
  });

  useShortcut({
    key: 'l',
    modifiers: { shift: true, ctrl: true },
    handler: handleToggleAppLogsPanel,
    description: 'Toggle Application Logs Panel',
    category: 'Global',
    enabled: !!onToggleAppLogsPanel,
  });

  useShortcut({
    key: ',',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleToggleSettings,
    description: 'Toggle settings',
    category: 'Global',
    enabled: !!onToggleSettings,
  });

  useShortcut({
    key: 'd',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleToggleObjectDiff,
    description: 'Toggle object diff viewer',
    category: 'Global',
    enabled: !!onToggleObjectDiff,
  });

  useShortcut({
    key: 'n',
    modifiers: macPlatform ? { meta: true, shift: true } : { ctrl: true, shift: true },
    handler: handleCreateResource,
    description: 'Create resource',
    category: 'Global',
    enabled: !!onCreateResource,
  });

  useShortcut({
    key: 'r',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleRefresh,
    description: 'Refresh current view',
    category: 'Navigation',
    enabled: !!onRefresh,
  });

  useShortcut({
    key: 'd',
    modifiers: { ctrl: true, shift: true },
    handler: handleToggleDiagnostics,
    description: 'Toggle diagnostics panel',
    category: 'Global',
    enabled: !!onToggleDiagnostics,
  });

  // Zoom shortcuts — the Wails native menu accelerators for +/- don't work on
  // Windows (the keys are missing from the Windows keyMap), so we register them
  // here in the frontend shortcut system where they work on all platforms.
  useShortcut({
    key: '=',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: zoomIn,
    description: 'Zoom in',
    category: 'View',
  });

  useShortcut({
    key: '-',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: zoomOut,
    description: 'Zoom out',
    category: 'View',
  });

  useShortcut({
    key: '0',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: resetZoom,
    description: 'Reset zoom',
    category: 'View',
  });

  // Handle menu:close event from the backend (Cmd/Ctrl+W via native menu).
  // Closes the active cluster tab, or quits when no tabs remain.
  useEffect(() => {
    const handleMenuClose = () => {
      if (selectedKubeconfigs.length <= 1) {
        Quit();
      } else {
        handleCloseClusterTab();
      }
    };

    EventsOn('menu:close', handleMenuClose);
    return () => {
      EventsOff('menu:close');
    };
  }, [selectedKubeconfigs, handleCloseClusterTab]);

  useShortcut({
    key: KeyCodes.ARROW_LEFT,
    modifiers: macPlatform ? { meta: true, alt: true } : { ctrl: true, alt: true },
    handler: () => handleSwitchClusterTab('prev'),
    description: 'Switch to previous cluster tab',
    category: 'Navigation',
    enabled: selectedKubeconfigs.length > 1,
  });

  useShortcut({
    key: KeyCodes.ARROW_RIGHT,
    modifiers: macPlatform ? { meta: true, alt: true } : { ctrl: true, alt: true },
    handler: () => handleSwitchClusterTab('next'),
    description: 'Switch to next cluster tab',
    category: 'Navigation',
    enabled: selectedKubeconfigs.length > 1,
  });

  useShortcut({
    key: KeyCodes.ESCAPE,
    handler: handleEscape,
    description: 'Close overlay/panel',
    category: 'Global',
    priority: 10,
  });

  return <ShortcutHelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />;
}
