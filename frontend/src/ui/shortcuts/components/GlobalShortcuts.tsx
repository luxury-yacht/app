/**
 * frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx
 *
 * UI component for GlobalShortcuts.
 * Handles rendering and interactions for the shared components.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useShortcut } from '../hooks';
import { useKeyboardContext } from '../context';
import { ShortcutHelpModal } from './ShortcutHelpModal';
import { KeyCodes } from '../constants';
import { isMacPlatform } from '@/utils/platform';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  getClusterTabOrder,
  hydrateClusterTabOrder,
  subscribeClusterTabOrder,
} from '@core/persistence/clusterTabOrder';

interface GlobalShortcutsProps {
  onToggleSidebar?: () => void;
  onToggleLogsPanel?: () => void;
  onToggleSettings?: () => void;
  onToggleObjectDiff?: () => void;
  onRefresh?: () => void;
  onToggleDiagnostics?: () => void;
  viewType?: string;
  isLogsPanelOpen?: boolean;
  isObjectPanelOpen?: boolean;
  isSettingsOpen?: boolean;
}

export function GlobalShortcuts({
  onToggleSidebar,
  onToggleLogsPanel,
  onToggleSettings,
  onToggleObjectDiff,
  onRefresh,
  onToggleDiagnostics,
  viewType,
  isLogsPanelOpen,
  isObjectPanelOpen,
  isSettingsOpen,
}: GlobalShortcutsProps) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isModalAnimating, setIsModalAnimating] = useState(false);
  const { setContext } = useKeyboardContext();
  const { selectedKubeconfig, selectedKubeconfigs, setSelectedKubeconfigs, setActiveKubeconfig } =
    useKubeconfig();
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

  // Update context based on current view
  useEffect(() => {
    const context: any = {};

    // Set view context
    if (isSettingsOpen) {
      context.view = 'settings';
    } else if (viewType === 'namespace') {
      context.view = 'list';
    } else {
      context.view = 'list';
    }

    // Set panel context - prioritize object panel over logs panel
    if (isObjectPanelOpen) {
      context.panelOpen = 'object';
    } else if (isLogsPanelOpen) {
      context.panelOpen = 'logs';
    } else {
      context.panelOpen = undefined;
    }

    setContext(context);
  }, [viewType, isLogsPanelOpen, isObjectPanelOpen, isSettingsOpen, setContext]);

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

  const handleToggleLogsPanel = useCallback(() => {
    onToggleLogsPanel?.();
  }, [onToggleLogsPanel]);

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
  const isLogsPanelOpenRef = useRef(isLogsPanelOpen);
  const isObjectPanelOpenRef = useRef(isObjectPanelOpen);

  useEffect(() => {
    isHelpOpenRef.current = isHelpOpen;
    isSettingsOpenRef.current = isSettingsOpen;
    isLogsPanelOpenRef.current = isLogsPanelOpen;
    isObjectPanelOpenRef.current = isObjectPanelOpen;
  }, [isHelpOpen, isSettingsOpen, isLogsPanelOpen, isObjectPanelOpen]);

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
    // 3. Logs panel (closes before object panel when both are open)
    // 4. Object panel
    if (isHelpOpenRef.current) {
      setIsHelpOpen(false);
    } else if (isSettingsOpenRef.current && onToggleSettings) {
      onToggleSettings(); // This will toggle it off
    } else if (isLogsPanelOpenRef.current && onToggleLogsPanel) {
      onToggleLogsPanel();
    } else if (isObjectPanelOpenRef.current) {
      // Object panel has its own ESC handler now
    }
  }, [onToggleSettings, onToggleLogsPanel]);

  // Register all shortcuts individually to avoid hooks in loops
  useShortcut({
    key: '?',
    modifiers: { shift: true },
    handler: toggleHelp,
    description: 'Show keyboard shortcuts help',
    category: 'Global',
    view: 'global',
  });

  useShortcut({
    key: 'b',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleToggleSidebar,
    description: 'Toggle sidebar',
    category: 'Global',
    enabled: !!onToggleSidebar,
    view: 'global',
  });

  useShortcut({
    key: 'l',
    modifiers: { shift: true, ctrl: true },
    handler: handleToggleLogsPanel,
    description: 'Toggle logs panel',
    category: 'Global',
    enabled: !!onToggleLogsPanel,
    view: 'global',
  });

  useShortcut({
    key: ',',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleToggleSettings,
    description: 'Toggle settings',
    category: 'Global',
    enabled: !!onToggleSettings,
    view: 'global',
  });

  useShortcut({
    key: 'd',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleToggleObjectDiff,
    description: 'Toggle object diff viewer',
    category: 'Global',
    enabled: !!onToggleObjectDiff,
    view: 'global',
  });

  useShortcut({
    key: 'r',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleRefresh,
    description: 'Refresh current view',
    category: 'Navigation',
    enabled: !!onRefresh,
    view: 'global',
  });

  useShortcut({
    key: 'd',
    modifiers: { ctrl: true, shift: true },
    handler: handleToggleDiagnostics,
    description: 'Toggle diagnostics panel',
    category: 'Global',
    enabled: !!onToggleDiagnostics,
    view: 'global',
  });

  useShortcut({
    key: 'w',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleCloseClusterTab,
    description: 'Close current cluster tab',
    category: 'Navigation',
    enabled: selectedKubeconfigs.length > 0,
    view: 'global',
  });

  useShortcut({
    key: KeyCodes.ARROW_LEFT,
    modifiers: macPlatform ? { meta: true, alt: true } : { ctrl: true, alt: true },
    handler: () => handleSwitchClusterTab('prev'),
    description: 'Switch to previous cluster tab',
    category: 'Navigation',
    enabled: selectedKubeconfigs.length > 1,
    view: 'global',
  });

  useShortcut({
    key: KeyCodes.ARROW_RIGHT,
    modifiers: macPlatform ? { meta: true, alt: true } : { ctrl: true, alt: true },
    handler: () => handleSwitchClusterTab('next'),
    description: 'Switch to next cluster tab',
    category: 'Navigation',
    enabled: selectedKubeconfigs.length > 1,
    view: 'global',
  });

  useShortcut({
    key: KeyCodes.ESCAPE,
    handler: handleEscape,
    description: 'Close overlay/panel',
    category: 'Global',
    view: 'global',
    priority: 10,
  });

  return <ShortcutHelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />;
}
