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
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  isSettingsOpen?: boolean;
}

export function GlobalShortcuts({
  onToggleAppLogsPanel,
  onToggleSettings,
  onRefresh,
  isAppLogsPanelOpen,
  isSettingsOpen,
}: Readonly<GlobalShortcutsProps>) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
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

  // Settings owns the foreground while open.
  const toggleHelp = useCallback(() => {
    if (!isSettingsOpen) {
      setIsHelpOpen((prev) => !prev);
    }
    return undefined;
  }, [isSettingsOpen]);

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

  const handleEscape = useCallback(() => {
    // Object panels own their Escape handling; global overlays take precedence.
    if (isHelpOpen) {
      setIsHelpOpen(false);
    } else if (isSettingsOpen && onToggleSettings) {
      onToggleSettings();
    } else if (isAppLogsPanelOpen && onToggleAppLogsPanel) {
      onToggleAppLogsPanel();
    }
    return undefined;
  }, [isHelpOpen, isSettingsOpen, isAppLogsPanelOpen, onToggleSettings, onToggleAppLogsPanel]);

  // Register all shortcuts individually to avoid hooks in loops
  useShortcut({
    key: '?',
    modifiers: { shift: true },
    handler: toggleHelp,
    description: 'Show keyboard shortcuts help',
    category: 'Settings & Tools',
    helpOrder: 20,
  });

  useShortcut({
    key: 'r',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler: handleRefresh,
    description: 'Refresh current view',
    category: 'Resource Data',
    helpOrder: 10,
    enabled: !!onRefresh,
  });

  // Handle the backend menu:close event from the role-aware application menu.
  // Closes the active cluster tab, or the current peer window when it has no
  // cluster tabs left.
  useEffect(() => {
    return onEvent('menu:close', handleCloseClusterTab);
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
    helpOrder: 40,
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
    helpOrder: 41,
    enabled: selectedKubeconfigs.length > 1,
  });

  useShortcut({
    key: KeyCodes.ESCAPE,
    handler: handleEscape,
    description: 'Close overlay/panel',
    category: 'Windows & Panels',
    helpOrder: 40,
    priority: 10,
  });

  return <ShortcutHelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />;
}
