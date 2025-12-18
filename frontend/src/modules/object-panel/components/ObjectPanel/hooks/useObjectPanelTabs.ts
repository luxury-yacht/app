import { useEffect, useMemo } from 'react';

import { useShortcut } from '@ui/shortcuts';
import { KeyboardShortcutPriority } from '@ui/shortcuts/priorities';

import { TABS } from '@modules/object-panel/components/ObjectPanel/constants';
import type {
  ComputedCapabilities,
  PanelAction,
  PanelObjectData,
  ViewType,
} from '@modules/object-panel/components/ObjectPanel/types';

interface UseObjectPanelTabsArgs {
  capabilities: ComputedCapabilities;
  objectData: PanelObjectData | null;
  isHelmRelease: boolean;
  isEvent: boolean;
  isOpen: boolean;
  navigationIndex: number;
  navigationHistoryLength: number;
  navigate: (index: number) => void;
  dispatch: React.Dispatch<PanelAction>;
  close: () => void;
  currentTab: ViewType;
}

interface ObjectPanelTabsResult {
  availableTabs: Array<{ id: string; label: string }>;
}

export const useObjectPanelTabs = ({
  capabilities,
  objectData,
  isHelmRelease,
  isEvent,
  isOpen,
  navigationIndex,
  navigationHistoryLength,
  navigate,
  dispatch,
  close,
  currentTab,
}: UseObjectPanelTabsArgs): ObjectPanelTabsResult => {
  const objectKind = objectData?.kind?.toLowerCase() ?? null;

  const availableTabs = useMemo(() => {
    const orderedTabs = [
      TABS.DETAILS,
      TABS.PODS,
      TABS.LOGS,
      TABS.EVENTS,
      TABS.YAML,
      TABS.SHELL,
      TABS.MANIFEST,
      TABS.VALUES,
      TABS.MAINTENANCE,
    ];

    return orderedTabs.filter((tab) => {
      if (isHelmRelease) {
        if (tab.id === 'events' || tab.id === 'yaml' || tab.id === 'pods') {
          return false;
        }
      } else if (tab.id === 'manifest' || tab.id === 'values') {
        return false;
      }

      if (isEvent && (tab.id === 'events' || tab.id === 'yaml')) {
        return false;
      }

      if ('onlyForKinds' in tab && Array.isArray(tab.onlyForKinds) && tab.onlyForKinds.length > 0) {
        if (!objectKind || !tab.onlyForKinds.includes(objectKind)) {
          return false;
        }
      }

      if ('alwaysShow' in tab && tab.alwaysShow) {
        return true;
      }

      if ('requiresCapability' in tab && tab.requiresCapability) {
        return capabilities[tab.requiresCapability as keyof typeof capabilities];
      }

      return true;
    });
  }, [capabilities, isEvent, isHelmRelease, objectKind]);

  useEffect(() => {
    if (!objectData) {
      return;
    }

    const isViewAvailable = availableTabs.some((tab) => tab.id === currentTab);
    if (!isViewAvailable && currentTab !== 'details') {
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'details' });
    }
  }, [availableTabs, currentTab, dispatch, objectData]);

  useShortcut({
    key: 'Escape',
    handler: () => {
      if (isOpen) {
        close();
        return true;
      }
      return false;
    },
    description: 'Close object panel',
    category: 'Object Panel',
    enabled: isOpen,
    view: 'global',
    priority: isOpen ? KeyboardShortcutPriority.OBJECT_PANEL_ESCAPE : 0,
  });

  useShortcut({
    key: 'ArrowLeft',
    handler: () => {
      if (isOpen && navigationIndex > 0) {
        navigate(navigationIndex - 1);
        return true;
      }
      return false;
    },
    description: 'Navigate to previous object',
    category: 'Object Panel',
    enabled: isOpen && navigationIndex > 0,
    view: 'global',
    priority: isOpen ? 20 : 0,
  });

  useShortcut({
    key: 'ArrowRight',
    handler: () => {
      if (isOpen && navigationIndex < navigationHistoryLength - 1) {
        navigate(navigationIndex + 1);
        return true;
      }
      return false;
    },
    description: 'Navigate to next object',
    category: 'Object Panel',
    enabled: isOpen && navigationIndex < navigationHistoryLength - 1,
    view: 'global',
    priority: isOpen ? 20 : 0,
  });

  useShortcut({
    key: '1',
    handler: () => {
      if (isOpen) {
        dispatch({ type: 'SET_ACTIVE_TAB', payload: 'details' });
        return true;
      }
      return false;
    },
    description: 'Switch to Details tab',
    category: 'Object Panel',
    enabled: isOpen,
    view: 'global',
    priority: isOpen ? 20 : 0,
  });

  useShortcut({
    key: '2',
    handler: () => {
      if (isOpen && capabilities.hasLogs) {
        dispatch({ type: 'SET_ACTIVE_TAB', payload: 'logs' });
        return true;
      }
      return false;
    },
    description: 'Switch to Logs tab',
    category: 'Object Panel',
    enabled: isOpen && capabilities.hasLogs,
    view: 'global',
    priority: isOpen ? 20 : 0,
  });

  useShortcut({
    key: '3',
    handler: () => {
      if (isOpen) {
        dispatch({ type: 'SET_ACTIVE_TAB', payload: 'events' });
        return true;
      }
      return false;
    },
    description: 'Switch to Events tab',
    category: 'Object Panel',
    enabled: isOpen,
    view: 'global',
    priority: isOpen ? 20 : 0,
  });

  useShortcut({
    key: '4',
    handler: () => {
      if (isOpen) {
        dispatch({ type: 'SET_ACTIVE_TAB', payload: 'yaml' });
        return true;
      }
      return false;
    },
    description: 'Switch to YAML tab',
    category: 'Object Panel',
    enabled: isOpen,
    view: 'global',
    priority: isOpen ? 20 : 0,
  });

  useShortcut({
    key: '5',
    handler: () => {
      if (isOpen && capabilities.hasShell) {
        dispatch({ type: 'SET_ACTIVE_TAB', payload: 'shell' });
        return true;
      }
      return false;
    },
    description: 'Switch to Shell tab',
    category: 'Object Panel',
    enabled: isOpen && capabilities.hasShell,
    view: 'global',
    priority: isOpen ? 20 : 0,
  });

  return {
    availableTabs,
  };
};
