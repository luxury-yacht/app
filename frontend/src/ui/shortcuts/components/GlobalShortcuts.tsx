/**
 * frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx
 *
 * UI component for GlobalShortcuts.
 * Handles rendering and interactions for the shared components.
 */

import { onEvent } from '@core/desktop-runtime';
import {
  getClusterTabOrder,
  hydrateClusterTabOrder,
  mergeClusterTabOrder,
  subscribeClusterTabOrder,
} from '@core/persistence/clusterTabOrder';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { eventBus } from '@/core/events';
import { closeActiveClusterOrWindow } from '@/ui/navigation/closeActiveClusterOrWindow';
import { isMacPlatform } from '@/utils/platform';
import { KeyCodes } from '../constants';
import { useShortcut } from '../hooks';
import { ShortcutHelpModal } from './ShortcutHelpModal';

interface GlobalShortcutsProps {
  onToggleAppLogsPanel?: () => void;
  onToggleSettings?: () => void;
  onRefresh?: () => void;
  isAppLogsPanelOpen?: boolean;
  isObjectPanelOpen?: boolean;
  isSettingsOpen?: boolean;
}

export function GlobalShortcuts({
  onToggleAppLogsPanel,
  onToggleSettings,
  onRefresh,
  isAppLogsPanelOpen,
  isObjectPanelOpen,
  isSettingsOpen,
}: Readonly<GlobalShortcutsProps>) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isModalAnimating, setIsModalAnimating] = useState(false);
  const { selectedKubeconfig, selectedKubeconfigs, setActiveKubeconfig, closeKubeconfig } =
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

  // Toggle help overlay - only if no other modal is open or animating
  const toggleHelp = useCallback(() => {
    if (!isSettingsOpen && !isModalAnimating) {
      setIsHelpOpen((prev) => !prev);
    }
    return undefined;
  }, [isSettingsOpen, isModalAnimating]);

  // Memoize all handlers to prevent re-registration
  const handleRefresh = useCallback(
    (e?: KeyboardEvent) => {
      e?.preventDefault();
      onRefresh?.();
      return false;
    },
    [onRefresh]
  );

  const handleCloseClusterTab = useCallback(() => {
    void closeActiveClusterOrWindow({
      selectedKubeconfig,
      selectedKubeconfigs,
      closeKubeconfig,
    }).catch((err) => {
      console.warn('Failed to close cluster tab or window:', err);
    });
  }, [closeKubeconfig, selectedKubeconfig, selectedKubeconfigs]);

  const orderedClusterSelections = useMemo(() => {
    // Follow the persisted tab order to mirror the visible cluster tabs.
    return mergeClusterTabOrder(selectedKubeconfigs, clusterTabOrder);
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
    return undefined;
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
    key: 'r',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleRefresh,
    description: 'Refresh current view',
    category: 'Navigation',
    enabled: !!onRefresh,
  });

  // Handle the backend menu:close event from the role-aware application menu.
  // Closes the active cluster tab, or the current peer window when it has no
  // cluster tabs left.
  useEffect(() => {
    const handleMenuClose = () => {
      handleCloseClusterTab();
    };

    return onEvent('menu:close', handleMenuClose);
  }, [handleCloseClusterTab]);

  useEffect(
    () => eventBus.on('application-menu:close', handleCloseClusterTab),
    [handleCloseClusterTab]
  );

  useShortcut({
    key: KeyCodes.ARROW_LEFT,
    modifiers: macPlatform ? { meta: true, alt: true } : { ctrl: true, alt: true },
    handler: () => {
      handleSwitchClusterTab('prev');
      return undefined;
    },
    description: 'Switch to previous cluster tab',
    category: 'Navigation',
    enabled: selectedKubeconfigs.length > 1,
  });

  useShortcut({
    key: KeyCodes.ARROW_RIGHT,
    modifiers: macPlatform ? { meta: true, alt: true } : { ctrl: true, alt: true },
    handler: () => {
      handleSwitchClusterTab('next');
      return undefined;
    },
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
