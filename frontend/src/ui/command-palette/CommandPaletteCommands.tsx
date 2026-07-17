/**
 * frontend/src/ui/command-palette/CommandPaletteCommands.tsx
 *
 * Module source for CommandPaletteCommands.
 * Implements CommandPaletteCommands logic for the UI layer.
 */

import { useAppearanceMode } from '@core/contexts/AppearanceModeContext';
import { useFavorites } from '@core/contexts/FavoritesContext';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useZoom } from '@core/contexts/ZoomContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { isAllNamespaces } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { FavoriteGenericIcon, FavoritePinIcon } from '@shared/components/icons/FavoriteIcons';
import { ZoomInIcon, ZoomOutIcon } from '@shared/components/icons/ObjectMapIcons';
import {
  AppearanceModeIcon,
  DarkModeIcon,
  KubeconfigsIcon,
  LightModeIcon,
} from '@shared/components/icons/SettingsIcons';
import {
  CategoryIcon,
  CloseIcon,
  CollapseSidebarIcon,
  DiagnosticsIcon,
  DiffIcon,
  ExpandSidebarIcon,
  InfoIcon,
  LogsIcon,
  NamespaceIcon,
  RefreshIcon,
  ResetFiltersIcon,
  SettingsIcon,
  WarningIcon,
} from '@shared/components/icons/SharedIcons';
import { clearAllGridTableState } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import { navigateToFavorite } from '@ui/favorites/navigateToFavorite';
import { type ReactNode, useCallback, useMemo } from 'react';
import { requestContextRefresh } from '@/core/data-access';
import { eventBus } from '@/core/events';
import {
  CLUSTER_VIEW_DESCRIPTORS,
  GLOBAL_VIEW_DESCRIPTORS,
  NAMESPACE_VIEW_DESCRIPTORS,
} from '@/core/navigation/viewRegistry';
import { useAutoRefresh } from '@/core/refresh';
import {
  setDimInactiveNamespaces,
  setExclusiveNamespaces,
  setUseShortResourceNames,
} from '@/core/settings/appPreferences';
import { useDimInactiveNamespaces } from '@/hooks/useDimInactiveNamespaces';
import { useExclusiveNamespaces } from '@/hooks/useExclusiveNamespaces';
import { useShortNames } from '@/hooks/useShortNames';
import type { ClusterViewType, NamespaceViewType } from '@/types/navigation/views';
import { changeAppearanceMode } from '@/utils/appearanceMode';
import { isMacPlatform } from '@/utils/platform';

export interface Command {
  id: string;
  label: string;
  renderLabel?: ReactNode;
  description?: string;
  icon?: ReactNode;
  category?: string;
  action: () => void;
  keywords?: string[];
  shortcut?: string | string[];
}

export function useCommandPaletteCommands() {
  const viewState = useViewState();
  const namespace = useNamespace();
  // Destructure kubeconfig fields so hook deps stay explicit.
  const {
    selectedKubeconfig,
    selectedClusterId,
    selectedKubeconfigs,
    openKubeconfig,
    closeKubeconfig,
    kubeconfigs,
    setActiveKubeconfig,
    getClusterMeta,
  } = useKubeconfig();
  const { favorites, setPendingFavorite } = useFavorites();
  const { mode } = useAppearanceMode();
  const { zoomIn, zoomOut, resetZoom, zoomLevel } = useZoom();
  const { enabled: autoRefreshEnabled, toggle: toggleAutoRefresh } = useAutoRefresh();
  const useShortResourceNames = useShortNames();
  const dimInactiveNamespaces = useDimInactiveNamespaces();
  const exclusiveNamespaces = useExclusiveNamespaces();

  const openClusterTab = useCallback(
    (tab: ClusterViewType) => {
      viewState.onClusterObjectsClick();
      viewState.setActiveClusterView(tab);
    },
    [viewState]
  );

  const openNamespaceTab = useCallback(
    (tab: NamespaceViewType) => {
      viewState.navigateToNamespace();
      viewState.setActiveNamespaceTab(tab);
    },
    [viewState]
  );

  const openGlobalView = useCallback(
    (view: (typeof GLOBAL_VIEW_DESCRIPTORS)[number]['id']) => {
      viewState.navigateToGlobal(view);
    },
    [viewState]
  );

  const closeCurrentClusterTab = useCallback(() => {
    if (viewState.viewType === 'global') {
      return;
    }
    const active = selectedKubeconfig;
    if (!active) {
      return;
    }
    if (!selectedKubeconfigs.includes(active)) {
      return;
    }
    void closeKubeconfig(active).catch((err) => {
      console.warn('Failed to close cluster:', err);
    });
  }, [closeKubeconfig, selectedKubeconfig, selectedKubeconfigs, viewState.viewType]);

  const selectNamespace = useCallback(
    (scope: string) => {
      namespace.setSelectedNamespace(scope);
      viewState.onNamespaceSelect(scope);
      if (isAllNamespaces(scope)) {
        viewState.setActiveNamespaceTab('workloads');
      }
    },
    [namespace, viewState]
  );

  const closeTabShortcut = useMemo(() => (isMacPlatform() ? ['⌘', 'W'] : ['Ctrl', 'W']), []);
  const diffObjectsShortcut = useMemo(() => (isMacPlatform() ? ['⌘', 'D'] : ['Ctrl', 'D']), []);
  const selectNamespaceShortcut = useMemo(
    () => (isMacPlatform() ? ['⇧', '⌘', 'N'] : ['Ctrl', 'Shift', 'N']),
    []
  );
  // The same accelerator as File → Open Cluster (backend/menu.go), which opens
  // the palette in kubeconfig selection.
  const selectKubeconfigShortcut = useMemo(
    () => (isMacPlatform() ? ['⌘', 'O'] : ['Ctrl', 'O']),
    []
  );

  const commands = useMemo(
    () => [
      // Application Commands
      {
        id: 'open-about',
        label: 'About',
        icon: <InfoIcon width={16} height={16} />,
        description: 'Open about dialog',
        category: 'Application',
        action: () => {
          viewState.setIsAboutOpen(true);
        },
        keywords: ['about', 'info', 'version'],
      },
      {
        id: 'open-settings',
        label: 'Settings',
        icon: <SettingsIcon width={16} height={16} />,
        description: 'Open application settings',
        category: 'Application',
        action: () => {
          viewState.setIsSettingsOpen(true);
        },
        keywords: ['settings', 'preferences', 'config'],
        shortcut: ['⌘', ','],
      },
      {
        id: 'toggle-sidebar',
        label: viewState.isSidebarVisible ? 'Hide Sidebar' : 'Show Sidebar',
        icon: viewState.isSidebarVisible ? (
          <CollapseSidebarIcon width={16} height={16} />
        ) : (
          <ExpandSidebarIcon width={16} height={16} />
        ),
        description: viewState.isSidebarVisible ? 'Hide the sidebar' : 'Show the sidebar',
        category: 'Application',
        action: () => {
          viewState.toggleSidebar();
        },
        keywords: ['sidebar', 'toggle', 'hide', 'show'],
        shortcut: isMacPlatform() ? ['⌘', 'B'] : ['Ctrl', 'B'],
      },
      {
        id: 'open-object-diff',
        label: 'Diff objects',
        icon: <DiffIcon width={16} height={16} />,
        description: 'Compare Kubernetes objects in a side-by-side YAML diff',
        category: 'Application',
        action: () => {
          viewState.setIsObjectDiffOpen(true);
        },
        keywords: ['diff', 'compare', 'yaml', 'objects', 'kubernetes'],
        shortcut: diffObjectsShortcut,
      },
      {
        id: 'toggle-application-logs',
        label: 'Application Logs panel',
        icon: <LogsIcon width={16} height={16} />,
        description: 'Toggle application logs',
        category: 'Application',
        action: () => {
          eventBus.emit('view:toggle-app-logs-panel');
        },
        keywords: ['logs', 'application', 'debug'],
        shortcut: ['⇧', '⌃', 'L'],
      },
      {
        id: 'toggle-diagnostics',
        label: 'Diagnostics panel',
        icon: <DiagnosticsIcon width={16} height={16} />,
        description: 'Show diagnostics (refresh, permissions)',
        category: 'Application',
        action: () => {
          eventBus.emit('view:toggle-diagnostics');
        },
        keywords: ['diagnostics', 'status', 'permissions', 'refresh'],
        shortcut: ['⇧', '⌃', 'D'],
      },

      // Zoom Commands
      {
        id: 'zoom-in',
        label: 'Zoom in',
        icon: <ZoomInIcon width={16} height={16} />,
        description: `Increase zoom level (currently ${zoomLevel}%)`,
        category: 'View',
        action: zoomIn,
        keywords: ['zoom', 'in', 'bigger', 'larger', 'increase', 'magnify'],
        shortcut: isMacPlatform() ? ['⌘', '+'] : ['Ctrl', '+'],
      },
      {
        id: 'zoom-out',
        label: 'Zoom out',
        icon: <ZoomOutIcon width={16} height={16} />,
        description: `Decrease zoom level (currently ${zoomLevel}%)`,
        category: 'View',
        action: zoomOut,
        keywords: ['zoom', 'out', 'smaller', 'decrease', 'reduce'],
        shortcut: isMacPlatform() ? ['⌘', '-'] : ['Ctrl', '-'],
      },
      {
        id: 'zoom-reset',
        label: 'Reset zoom',
        description: `Reset zoom to 100% (currently ${zoomLevel}%)`,
        category: 'View',
        action: resetZoom,
        keywords: ['zoom', 'reset', 'default', 'normal', '100'],
        shortcut: isMacPlatform() ? ['⌘', '0'] : ['Ctrl', '0'],
      },

      // Settings Commands
      {
        id: 'mode-system',
        label: 'Follow the system for light/dark mode',
        icon: <AppearanceModeIcon width={16} height={16} />,
        description: `Use system appearance mode${mode === 'system' ? ' (current)' : ''}`,
        category: 'Settings',
        action: async () => {
          try {
            await changeAppearanceMode('system');
          } catch (error) {
            console.error('Failed to set system mode:', error);
          }
        },
        keywords: ['mode', 'system', 'auto', 'automatic', 'appearance', 'os'],
      },
      {
        id: 'mode-light',
        label: 'Light mode',
        icon: <LightModeIcon width={16} height={16} />,
        description: `Switch to light mode${mode === 'light' ? ' (current)' : ''}`,
        category: 'Settings',
        action: async () => {
          try {
            await changeAppearanceMode('light');
          } catch (error) {
            console.error('Failed to set light mode:', error);
          }
        },
        keywords: ['mode', 'light', 'bright', 'white', 'appearance'],
      },
      {
        id: 'mode-dark',
        label: 'Dark mode',
        icon: <DarkModeIcon width={16} height={16} />,
        description: `Switch to dark mode${mode === 'dark' ? ' (current)' : ''}`,
        category: 'Settings',
        action: async () => {
          try {
            await changeAppearanceMode('dark');
          } catch (error) {
            console.error('Failed to set dark mode:', error);
          }
        },
        keywords: ['mode', 'dark', 'night', 'black', 'appearance'],
      },
      {
        id: 'toggle-exclusive-namespaces',
        label: exclusiveNamespaces ? 'Disable exclusive namespaces' : 'Enable exclusive namespaces',
        icon: viewState.isSidebarVisible ? (
          <CollapseSidebarIcon width={16} height={16} />
        ) : (
          <ExpandSidebarIcon width={16} height={16} />
        ),
        description:
          'When enabled, only one namespace at a time can be expanded in the Sidebar. Expanding a different namespace will collapse the currently expanded one.',
        category: 'Settings',
        action: async () => {
          const newState = !exclusiveNamespaces;

          try {
            await setExclusiveNamespaces(newState);
          } catch (error) {
            console.error('Failed to toggle exclusive namespaces:', error);
          }
        },
        keywords: ['exclusive', 'namespaces', 'sidebar', 'expand', 'collapse', 'toggle'],
      },
      {
        id: 'toggle-dim-inactive-namespaces',
        label: dimInactiveNamespaces
          ? 'Disable inactive namespace dimming'
          : 'Enable inactive namespace dimming',
        icon: viewState.isSidebarVisible ? (
          <CollapseSidebarIcon width={16} height={16} />
        ) : (
          <ExpandSidebarIcon width={16} height={16} />
        ),
        description: 'Dim namespaces in the Sidebar that have no Workloads.',
        category: 'Settings',
        action: async () => {
          const newState = !dimInactiveNamespaces;

          try {
            await setDimInactiveNamespaces(newState);
          } catch (error) {
            console.error('Failed to toggle dim inactive namespaces:', error);
          }
        },
        keywords: ['dim', 'inactive', 'namespaces', 'sidebar', 'workloads', 'toggle'],
      },
      {
        id: 'toggle-auto-refresh',
        label: autoRefreshEnabled ? 'Disable auto-refresh' : 'Enable auto-refresh',
        icon: <RefreshIcon width={16} height={16} />,
        description: 'Enable or disable automatic refresh',
        category: 'Settings',
        action: toggleAutoRefresh,
        keywords: ['auto', 'refresh', 'toggle', 'pause', 'resume', 'automatic'],
      },
      {
        id: 'refresh-view',
        label: 'Refresh current view',
        icon: <RefreshIcon width={16} height={16} />,
        description: 'Manually refresh the current view',
        category: 'Settings',
        action: () => {
          void requestContextRefresh({ reason: 'user' });
        },
        keywords: ['refresh', 'reload', 'update'],
        shortcut: ['⌘', 'R'],
      },
      {
        id: 'reset-all-gridtable-state',
        label: 'Reset all views',
        icon: <ResetFiltersIcon width={16} height={16} />,
        description: 'Clear all persisted GridTable state (columns, sort, filters)',
        category: 'Settings',
        action: () => {
          void clearAllGridTableState();
        },
        keywords: ['reset', 'grid', 'views', 'table', 'columns', 'sort'],
      },
      {
        id: 'toggle-short-names',
        label: useShortResourceNames ? 'Disable short names' : 'Enable short names',
        icon: <SettingsIcon width={16} height={16} />,
        description: 'Toggle between short and full resource type names',
        category: 'Settings',
        action: async () => {
          const newState = !useShortResourceNames;

          try {
            await setUseShortResourceNames(newState);
          } catch (error) {
            console.error('Failed to toggle short names:', error);
          }
        },
        keywords: ['short', 'names', 'abbreviations', 'types', 'resources', 'toggle'],
      },

      // Navigation Commands
      {
        id: 'close-cluster-tab',
        label: 'Close active cluster tab',
        icon: <CloseIcon width={16} height={16} />,
        description: 'Close the active cluster tab',
        category: 'Navigation',
        action: closeCurrentClusterTab,
        shortcut: closeTabShortcut,
        keywords: ['cluster', 'tab', 'close', 'kubeconfig'],
      },
      {
        id: 'select-kubeconfig',
        label: 'Select kubeconfig...',
        icon: <KubeconfigsIcon width={16} height={16} />,
        description: 'Switch to a different kubeconfig',
        category: 'Navigation',
        action: () => {
          // Will be handled specially in CommandPalette component
        },
        keywords: ['kubeconfig', 'context', 'cluster', 'switch'],
        shortcut: selectKubeconfigShortcut,
      },
      {
        id: 'select-namespace',
        label: 'Select namespace... ',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'Change to a different namespace',
        category: 'Navigation',
        action: () => {
          // Handled specially in CommandPalette component
        },
        keywords: ['namespace', 'change', 'select'],
        shortcut: selectNamespaceShortcut,
      },
      ...(selectedKubeconfigs.length > 1
        ? GLOBAL_VIEW_DESCRIPTORS.map((view) => ({
            id: `global-${view.id}`,
            label: `Global - ${view.label}`,
            icon: <CategoryIcon width={16} height={16} />,
            description: view.description,
            category: 'Navigation',
            action: () => openGlobalView(view.id),
            keywords: [...view.keywords],
          }))
        : []),
      ...CLUSTER_VIEW_DESCRIPTORS.map((view) => ({
        id: `cluster-${view.id}`,
        label: `Cluster - ${view.label}`,
        icon:
          view.id === 'attention' ? (
            <WarningIcon width={16} height={16} />
          ) : (
            <CategoryIcon width={16} height={16} />
          ),
        description: view.description,
        category: 'Navigation',
        action: () => openClusterTab(view.id),
        keywords: [...view.keywords],
      })),
    ],
    [
      viewState,
      mode,
      openClusterTab,
      openGlobalView,
      closeCurrentClusterTab,
      closeTabShortcut,
      selectNamespaceShortcut,
      selectKubeconfigShortcut,
      toggleAutoRefresh,
      diffObjectsShortcut,
      autoRefreshEnabled,
      useShortResourceNames,
      dimInactiveNamespaces,
      exclusiveNamespaces,
      zoomIn,
      zoomOut,
      resetZoom,
      zoomLevel,
      selectedKubeconfigs.length,
    ]
  );

  // Add namespace view navigation commands (only when a namespace is selected in the sidebar)
  const namespaceviewCommands = useMemo(() => {
    // Only show namespace view commands when a namespace is selected in the sidebar
    // This means the namespace is the active context rather than the cluster overview
    const isNamespaceSelected =
      viewState.sidebarSelection?.type === 'namespace' &&
      viewState.sidebarSelection?.value &&
      viewState.sidebarSelection?.value.trim() !== '';

    if (!isNamespaceSelected) {
      return [];
    }

    return NAMESPACE_VIEW_DESCRIPTORS.map((view) => ({
      id: `namespace-${view.id}`,
      label: `Namespace - ${view.label}`,
      icon: <NamespaceIcon width={16} height={16} />,
      description: view.description,
      category: 'Navigation',
      action: () => openNamespaceTab(view.id),
      keywords: [...view.keywords],
    }));
  }, [viewState, openNamespaceTab]);

  // Add namespace-specific commands dynamically
  const namespaceCommands = useMemo(() => {
    if (!namespace.namespaces || namespace.namespaces.length === 0) {
      return [];
    }

    return namespace.namespaces.map((ns) => ({
      id: `namespace-${ns.scope}`,
      label: ns.name,
      icon: <NamespaceIcon width={16} height={16} />,
      description: 'Switch to this namespace',
      category: 'Namespaces',
      action: () => selectNamespace(ns.scope),
      keywords: ['namespace', ns.name, ns.scope],
    }));
  }, [namespace.namespaces, selectNamespace]);

  // Add kubeconfig-specific commands dynamically
  const kubeconfigCommands = useMemo(() => {
    if (!kubeconfigs || kubeconfigs.length === 0) {
      return [];
    }

    // Order by context (the primary identity users read), then filename to keep
    // duplicate context names deterministic.
    const sorted = [...kubeconfigs].sort((a, b) => {
      const byContext = a.context.localeCompare(b.context);
      return byContext !== 0 ? byContext : a.name.localeCompare(b.name);
    });

    return sorted.map((config) => {
      // Backend ALWAYS expects format "path:context"
      const configValue = `${config.path}:${config.context}`;
      const isActive = selectedKubeconfigs.includes(configValue);
      const label = `${config.name}:${config.context}`;
      const isInvalid = config.invalid;

      return {
        id: `kubeconfig-${configValue}`,
        label,
        renderLabel: (
          <span className="command-palette-kubeconfig-label">
            <span className="command-palette-kubeconfig-context">{config.context}</span>
            {!!isInvalid && (
              <span className="command-palette-kubeconfig-invalid" title={config.invalidReason}>
                ⚠ invalid
              </span>
            )}
            {config.name !== config.context && (
              <span className="command-palette-kubeconfig-file">{config.name}</span>
            )}
          </span>
        ),
        description: isInvalid
          ? `Invalid: ${config.invalidReason || 'unusable context'}`
          : config.name !== config.context
            ? `From ${config.name}`
            : 'Switch to this context',
        category: 'Kubeconfigs',
        icon: isInvalid ? undefined : isActive ? '✓' : undefined,
        action: () => {
          if (isInvalid) {
            return; // A structurally-invalid context can't be opened.
          }
          if (isActive) {
            setActiveKubeconfig(configValue);
            return;
          }
          void openKubeconfig(configValue);
        },
        keywords: ['kubeconfig', 'context', config.name, config.context],
      };
    });
  }, [kubeconfigs, openKubeconfig, selectedKubeconfigs, setActiveKubeconfig]);

  // Build commands from saved favorites so they appear as a searchable group.
  const favoriteCommands: Command[] = useMemo(
    () =>
      favorites.map((fav) => ({
        id: `fav-${fav.id}`,
        label: fav.name,
        icon: fav.clusterSelection ? (
          <FavoritePinIcon width={16} height={16} />
        ) : (
          <FavoriteGenericIcon width={16} height={16} />
        ),
        category: 'Favorites',
        action: () => {
          navigateToFavorite(fav, {
            selectedKubeconfigs,
            selectedClusterId,
            openKubeconfig,
            setActiveKubeconfig,
            getClusterMeta,
            setPendingFavorite,
          });
        },
        keywords: ['favorite', 'bookmark', fav.view, fav.namespace].filter(Boolean),
      })),
    [
      favorites,
      selectedKubeconfigs,
      selectedClusterId,
      openKubeconfig,
      setActiveKubeconfig,
      getClusterMeta,
      setPendingFavorite,
    ]
  );

  return [
    ...commands,
    ...namespaceviewCommands,
    ...favoriteCommands,
    ...namespaceCommands,
    ...kubeconfigCommands,
  ];
}
