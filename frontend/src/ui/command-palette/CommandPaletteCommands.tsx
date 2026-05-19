/**
 * frontend/src/ui/command-palette/CommandPaletteCommands.tsx
 *
 * Module source for CommandPaletteCommands.
 * Implements CommandPaletteCommands logic for the UI layer.
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useFavorites } from '@core/contexts/FavoritesContext';
import { navigateToFavorite } from '@ui/favorites/navigateToFavorite';
import {
  SettingsIcon,
  CollapseSidebarIcon,
  ExpandSidebarIcon,
  InfoIcon,
  CloseIcon,
  ResetFiltersIcon,
  RefreshIcon,
  DiagnosticsIcon,
  DiffIcon,
  LogsIcon,
  CategoryIcon,
  NamespaceIcon,
} from '@shared/components/icons/SharedIcons';
import { FavoriteGenericIcon, FavoritePinIcon } from '@shared/components/icons/FavoriteIcons';
import { ZoomInIcon, ZoomOutIcon } from '@shared/components/icons/ObjectMapIcons';
import {
  AppearanceModeIcon,
  DarkModeIcon,
  KubeconfigsIcon,
  LightModeIcon,
} from '@shared/components/icons/SettingsIcons';
import { useAppearanceMode } from '@core/contexts/AppearanceModeContext';
import { useZoom } from '@core/contexts/ZoomContext';
import { requestContextRefresh } from '@/core/data-access';
import { useAutoRefresh } from '@/core/refresh';
import { changeAppearanceMode } from '@/utils/appearanceMode';
import { isAllNamespaces } from '@modules/namespace/constants';
import type { ClusterViewType, NamespaceViewType } from '@/types/navigation/views';
import { clearAllGridTableState } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import { eventBus } from '@/core/events';
import { isMacPlatform } from '@/utils/platform';
import {
  setDimInactiveNamespaces,
  setExclusiveNamespaces,
  setUseShortResourceNames,
} from '@/core/settings/appPreferences';
import { useDimInactiveNamespaces } from '@/hooks/useDimInactiveNamespaces';
import { useExclusiveNamespaces } from '@/hooks/useExclusiveNamespaces';
import { useShortNames } from '@/hooks/useShortNames';

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

  const closeCurrentClusterTab = useCallback(() => {
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
  }, [closeKubeconfig, selectedKubeconfig, selectedKubeconfigs]);

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
      },
      {
        id: 'cluster-browse',
        label: 'Cluster - Browse',
        icon: <CategoryIcon width={16} height={16} />,
        description: 'Browse all catalogued Kubernetes objects',
        category: 'Navigation',
        action: () => openClusterTab('browse'),
        keywords: ['cluster', 'browse', 'catalog', 'objects'],
      },
      {
        id: 'cluster-nodes',
        label: 'Cluster - Nodes',
        icon: <CategoryIcon width={16} height={16} />,
        description: 'View nodes',
        category: 'Navigation',
        action: () => openClusterTab('nodes'),
        keywords: ['cluster', 'nodes', 'servers', 'machines'],
      },
      {
        id: 'cluster-config',
        label: 'Cluster - Config',
        icon: <CategoryIcon width={16} height={16} />,
        description: 'View cluster configuration resources',
        category: 'Navigation',
        action: () => openClusterTab('config'),
        keywords: ['cluster', 'config', 'ingress', 'classes'],
      },
      {
        id: 'cluster-storage',
        label: 'Cluster - Storage',
        icon: <CategoryIcon width={16} height={16} />,
        description: 'View persistent volumes and storage classes',
        category: 'Navigation',
        action: () => openClusterTab('storage'),
        keywords: ['cluster', 'storage', 'volumes', 'pvs', 'persistent', 'classes'],
      },
      {
        id: 'cluster-rbac',
        label: 'Cluster - RBAC',
        icon: <CategoryIcon width={16} height={16} />,
        description: 'View cluster RBAC resources',
        category: 'Navigation',
        action: () => openClusterTab('rbac'),
        keywords: ['cluster', 'security', 'rbac', 'roles', 'bindings', 'admission'],
      },
      {
        id: 'cluster-crds',
        label: 'Cluster - CRDs',
        icon: <CategoryIcon width={16} height={16} />,
        description: 'View custom resource definitions',
        category: 'Navigation',
        action: () => openClusterTab('crds'),
        keywords: ['cluster', 'crds', 'custom', 'resources', 'definitions'],
      },
      {
        id: 'cluster-custom',
        label: 'Cluster - Custom Resources',
        icon: <CategoryIcon width={16} height={16} />,
        description: 'View cluster-scoped custom resources',
        category: 'Navigation',
        action: () => openClusterTab('custom'),
        keywords: ['cluster', 'custom resources', 'crs'],
      },
      {
        id: 'cluster-events',
        label: 'Cluster - Events',
        icon: <CategoryIcon width={16} height={16} />,
        description: 'View cluster events',
        category: 'Navigation',
        action: () => openClusterTab('events'),
        keywords: ['cluster', 'events', 'logs', 'history'],
      },
    ],
    [
      viewState,
      mode,
      openClusterTab,
      closeCurrentClusterTab,
      closeTabShortcut,
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

    return [
      {
        id: 'namespace-workloads',
        label: 'Namespace - Workloads',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View deployments, statefulsets, daemonsets',
        category: 'Navigation',
        action: () => openNamespaceTab('workloads'),
        keywords: [
          'workloads',
          'deployments',
          'statefulsets',
          'daemonsets',
          'cronjobs',
          'jobs',
          'pods',
        ],
      },
      {
        id: 'namespace-pods',
        label: 'Namespace - Pods',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View pods and their current status',
        category: 'Navigation',
        action: () => openNamespaceTab('pods'),
        keywords: ['pods', 'containers', 'workloads'],
      },
      {
        id: 'namespace-config',
        label: 'Namespace - Config',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View configmaps and secrets',
        category: 'Navigation',
        action: () => openNamespaceTab('config'),
        keywords: ['config', 'configmaps', 'secrets'],
      },
      {
        id: 'namespace-storage',
        label: 'Namespace - Storage',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View persistent volume claims',
        category: 'Navigation',
        action: () => openNamespaceTab('storage'),
        keywords: ['namespace', 'storage', 'pvcs', 'claims'],
      },
      {
        id: 'namespace-network',
        label: 'Namespace - Network',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View services and ingresses',
        category: 'Navigation',
        action: () => openNamespaceTab('network'),
        keywords: ['network', 'services', 'ingress'],
      },
      {
        id: 'namespace-rbac',
        label: 'Namespace - RBAC',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View roles and bindings',
        category: 'Navigation',
        action: () => openNamespaceTab('rbac'),
        keywords: ['namespace', 'security', 'rbac', 'roles', 'bindings'],
      },
      {
        id: 'namespace-autoscaling',
        label: 'Namespace - Autoscaling',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View horizontal pod autoscalers',
        category: 'Navigation',
        action: () => openNamespaceTab('autoscaling'),
        keywords: ['autoscaling', 'hpa', 'scaling'],
      },
      {
        id: 'namespace-quotas',
        label: 'Namespace - Quotas',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View resource quotas and limits',
        category: 'Navigation',
        action: () => openNamespaceTab('quotas'),
        keywords: ['quotas', 'limits', 'resources'],
      },
      {
        id: 'namespace-custom',
        label: 'Namespace - Custom',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View custom resources',
        category: 'Navigation',
        action: () => openNamespaceTab('custom'),
        keywords: ['custom', 'resources', 'crs'],
      },
      {
        id: 'namespace-helm',
        label: 'Namespace - Helm',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View Helm releases',
        category: 'Navigation',
        action: () => openNamespaceTab('helm'),
        keywords: ['helm', 'charts', 'releases'],
      },
      {
        id: 'namespace-events',
        label: 'Namespace - Events',
        icon: <NamespaceIcon width={16} height={16} />,
        description: 'View namespace events',
        category: 'Navigation',
        action: () => openNamespaceTab('events'),
        keywords: ['namespace', 'events', 'logs'],
      },
    ];
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

    return kubeconfigs.map((config) => {
      // Backend ALWAYS expects format "path:context"
      const configValue = `${config.path}:${config.context}`;
      const isActive = selectedKubeconfigs.includes(configValue);
      const label = `${config.name}:${config.context}`;

      return {
        id: `kubeconfig-${configValue}`,
        label,
        renderLabel: (
          <span className="command-palette-kubeconfig-label">
            <span className="command-palette-kubeconfig-file">{config.name}</span>
            <span className="command-palette-kubeconfig-separator" aria-hidden="true">
              :
            </span>
            <span className="command-palette-kubeconfig-context">{config.context}</span>
          </span>
        ),
        description:
          config.name !== config.context ? `From ${config.name}` : 'Switch to this context',
        category: 'Kubeconfigs',
        icon: isActive ? '✓' : undefined,
        action: () => {
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
