/**
 * frontend/src/ui/command-palette/CommandPaletteCommands.tsx
 *
 * Module source for CommandPaletteCommands.
 * Implements CommandPaletteCommands logic for the UI layer.
 */

import { useCallback, useMemo } from 'react';
import { useViewState } from '@core/contexts/ViewStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useTheme } from '@core/contexts/ThemeContext';
import { useZoom } from '@core/contexts/ZoomContext';
import { refreshOrchestrator, useAutoRefresh } from '@/core/refresh';
import { changeTheme } from '@/utils/themes';
import { isAllNamespaces } from '@modules/namespace/constants';
import type { ClusterViewType, NamespaceViewType } from '@/types/navigation/views';
import { clearAllGridTableState } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import { eventBus } from '@/core/events';
import { isMacPlatform } from '@/utils/platform';
import { getUseShortResourceNames, setUseShortResourceNames } from '@/core/settings/appPreferences';
import { usePortForwardsPanel } from '@modules/port-forward';

export interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: string;
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
    selectedKubeconfigs,
    setSelectedKubeconfigs,
    kubeconfigs,
    setActiveKubeconfig,
  } = useKubeconfig();
  const { theme } = useTheme();
  const { zoomIn, zoomOut, resetZoom, zoomLevel } = useZoom();
  const { toggle: toggleAutoRefresh } = useAutoRefresh();
  const portForwardsPanel = usePortForwardsPanel();

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
    const nextSelections = selectedKubeconfigs.filter((selection) => selection !== active);
    void setSelectedKubeconfigs(nextSelections);
  }, [selectedKubeconfig, selectedKubeconfigs, setSelectedKubeconfigs]);

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
        label: 'Show/Hide Sidebar',
        description: 'Show or hide the sidebar',
        category: 'Application',
        action: () => {
          viewState.toggleSidebar();
        },
        keywords: ['sidebar', 'toggle', 'hide', 'show'],
        shortcut: 'B',
      },
      {
        id: 'open-object-diff',
        label: 'Diff Objects',
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
        label: 'Application Logs Panel',
        description: 'Toggle application logs',
        category: 'Application',
        action: () => {
          eventBus.emit('view:toggle-app-logs');
        },
        keywords: ['logs', 'application', 'debug'],
        shortcut: ['⇧', '⌃', 'L'],
      },
      {
        id: 'toggle-port-forwards',
        label: 'Port Forwards Panel',
        description: 'Toggle port forwards panel',
        category: 'Application',
        action: () => {
          portForwardsPanel.toggle();
        },
        keywords: ['port', 'forward', 'tunnel', 'kubectl'],
      },
      {
        id: 'toggle-diagnostics',
        label: 'Diagnostics Panel',
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
        label: 'Zoom In',
        description: `Increase zoom level (currently ${zoomLevel}%)`,
        category: 'View',
        action: zoomIn,
        keywords: ['zoom', 'in', 'bigger', 'larger', 'increase', 'magnify'],
        shortcut: isMacPlatform() ? ['⌘', '+'] : ['Ctrl', '+'],
      },
      {
        id: 'zoom-out',
        label: 'Zoom Out',
        description: `Decrease zoom level (currently ${zoomLevel}%)`,
        category: 'View',
        action: zoomOut,
        keywords: ['zoom', 'out', 'smaller', 'decrease', 'reduce'],
        shortcut: isMacPlatform() ? ['⌘', '-'] : ['Ctrl', '-'],
      },
      {
        id: 'zoom-reset',
        label: 'Reset Zoom',
        description: `Reset zoom to 100% (currently ${zoomLevel}%)`,
        category: 'View',
        action: resetZoom,
        keywords: ['zoom', 'reset', 'default', 'normal', '100'],
        shortcut: isMacPlatform() ? ['⌘', '0'] : ['Ctrl', '0'],
      },

      // Settings Commands
      {
        id: 'reset-all-gridtable-state',
        label: 'Reset All Views',
        description: 'Clear all persisted GridTable state (columns, sort, filters)',
        category: 'Settings',
        action: () => {
          void clearAllGridTableState();
        },
        keywords: ['reset', 'grid', 'views', 'table', 'columns', 'sort'],
      },
      {
        id: 'toggle-auto-refresh',
        label: 'Toggle Auto-Refresh',
        description: 'Enable or disable automatic refresh',
        category: 'Settings',
        action: toggleAutoRefresh,
        keywords: ['auto', 'refresh', 'toggle', 'pause', 'resume', 'automatic'],
      },
      {
        id: 'toggle-short-names',
        label: 'Toggle Short Names',
        description: 'Toggle between short and full resource type names',
        category: 'Settings',
        action: async () => {
          // Get current state
          const currentState = getUseShortResourceNames();
          const newState = !currentState;

          try {
            await setUseShortResourceNames(newState);
          } catch (error) {
            console.error('Failed to toggle short names:', error);
          }
        },
        keywords: ['short', 'names', 'abbreviations', 'types', 'resources', 'toggle'],
      },
      {
        id: 'theme-light',
        label: 'Theme - Light',
        description: `Switch to light theme${theme === 'light' ? ' (current)' : ''}`,
        category: 'Settings',
        action: async () => {
          try {
            await changeTheme('light');
          } catch (error) {
            console.error('Failed to set light theme:', error);
          }
        },
        keywords: ['theme', 'light', 'bright', 'white', 'appearance'],
      },
      {
        id: 'theme-dark',
        label: 'Theme - Dark',
        description: `Switch to dark theme${theme === 'dark' ? ' (current)' : ''}`,
        category: 'Settings',
        action: async () => {
          try {
            await changeTheme('dark');
          } catch (error) {
            console.error('Failed to set dark theme:', error);
          }
        },
        keywords: ['theme', 'dark', 'night', 'black', 'appearance'],
      },
      {
        id: 'theme-system',
        label: 'Theme - System',
        description: `Use system theme preference${theme === 'system' ? ' (current)' : ''}`,
        category: 'Settings',
        action: async () => {
          try {
            await changeTheme('system');
          } catch (error) {
            console.error('Failed to set system theme:', error);
          }
        },
        keywords: ['theme', 'system', 'auto', 'automatic', 'appearance', 'os'],
      },

      // Navigation Commands
      {
        id: 'refresh-view',
        label: 'Refresh Current View',
        description: 'Manually refresh the current view',
        category: 'Navigation',
        action: () => {
          void refreshOrchestrator.triggerManualRefreshForContext();
        },
        keywords: ['refresh', 'reload', 'update'],
        shortcut: ['⌘', 'R'],
      },
      {
        id: 'close-cluster-tab',
        label: 'Close Current Cluster Tab',
        description: 'Close the active cluster tab',
        category: 'Navigation',
        action: closeCurrentClusterTab,
        shortcut: closeTabShortcut,
        keywords: ['cluster', 'tab', 'close', 'kubeconfig'],
      },
      {
        id: 'select-kubeconfig',
        label: 'Select Kubeconfig',
        description: 'Switch to a different kubeconfig',
        category: 'Navigation',
        action: () => {
          // Will be handled specially in CommandPalette component
        },
        keywords: ['kubeconfig', 'context', 'cluster', 'switch'],
      },
      {
        id: 'select-namespace',
        label: 'Select Namespace',
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
        description: 'Browse all catalogued Kubernetes objects',
        category: 'Navigation',
        action: () => openClusterTab('browse'),
        keywords: ['cluster', 'browse', 'catalog', 'objects'],
      },
      {
        id: 'cluster-nodes',
        label: 'Cluster - Nodes',
        description: 'View nodes',
        category: 'Navigation',
        action: () => openClusterTab('nodes'),
        keywords: ['cluster', 'nodes', 'servers', 'machines'],
      },
      {
        id: 'cluster-config',
        label: 'Cluster - Config',
        description: 'View cluster configuration resources',
        category: 'Navigation',
        action: () => openClusterTab('config'),
        keywords: ['cluster', 'config', 'ingress', 'classes'],
      },
      {
        id: 'cluster-storage',
        label: 'Cluster - Storage',
        description: 'View persistent volumes and storage classes',
        category: 'Navigation',
        action: () => openClusterTab('storage'),
        keywords: ['cluster', 'storage', 'volumes', 'pvs', 'persistent', 'classes'],
      },
      {
        id: 'cluster-rbac',
        label: 'Cluster - RBAC',
        description: 'View cluster RBAC resources',
        category: 'Navigation',
        action: () => openClusterTab('rbac'),
        keywords: ['cluster', 'security', 'rbac', 'roles', 'bindings', 'admission'],
      },
      {
        id: 'cluster-crds',
        label: 'Cluster - CRDs',
        description: 'View custom resource definitions',
        category: 'Navigation',
        action: () => openClusterTab('crds'),
        keywords: ['cluster', 'crds', 'custom', 'resources', 'definitions'],
      },
      {
        id: 'cluster-custom',
        label: 'Cluster - Custom Resources',
        description: 'View cluster-scoped custom resources',
        category: 'Navigation',
        action: () => openClusterTab('custom'),
        keywords: ['cluster', 'custom resources', 'crs'],
      },
      {
        id: 'cluster-events',
        label: 'Cluster - Events',
        description: 'View cluster events',
        category: 'Navigation',
        action: () => openClusterTab('events'),
        keywords: ['cluster', 'events', 'logs', 'history'],
      },
    ],
    [
      viewState,
      theme,
      openClusterTab,
      closeCurrentClusterTab,
      closeTabShortcut,
      toggleAutoRefresh,
      diffObjectsShortcut,
      zoomIn,
      zoomOut,
      resetZoom,
      zoomLevel,
      portForwardsPanel,
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
        description: 'View pods and their current status',
        category: 'Navigation',
        action: () => openNamespaceTab('pods'),
        keywords: ['pods', 'containers', 'workloads'],
      },
      {
        id: 'namespace-config',
        label: 'Namespace - Config',
        description: 'View configmaps and secrets',
        category: 'Navigation',
        action: () => openNamespaceTab('config'),
        keywords: ['config', 'configmaps', 'secrets'],
      },
      {
        id: 'namespace-storage',
        label: 'Namespace - Storage',
        description: 'View persistent volume claims',
        category: 'Navigation',
        action: () => openNamespaceTab('storage'),
        keywords: ['namespace', 'storage', 'pvcs', 'claims'],
      },
      {
        id: 'namespace-network',
        label: 'Namespace - Network',
        description: 'View services and ingresses',
        category: 'Navigation',
        action: () => openNamespaceTab('network'),
        keywords: ['network', 'services', 'ingress'],
      },
      {
        id: 'namespace-rbac',
        label: 'Namespace - RBAC',
        description: 'View roles and bindings',
        category: 'Navigation',
        action: () => openNamespaceTab('rbac'),
        keywords: ['namespace', 'security', 'rbac', 'roles', 'bindings'],
      },
      {
        id: 'namespace-autoscaling',
        label: 'Namespace - Autoscaling',
        description: 'View horizontal pod autoscalers',
        category: 'Navigation',
        action: () => openNamespaceTab('autoscaling'),
        keywords: ['autoscaling', 'hpa', 'scaling'],
      },
      {
        id: 'namespace-quotas',
        label: 'Namespace - Quotas',
        description: 'View resource quotas and limits',
        category: 'Navigation',
        action: () => openNamespaceTab('quotas'),
        keywords: ['quotas', 'limits', 'resources'],
      },
      {
        id: 'namespace-custom',
        label: 'Namespace - Custom',
        description: 'View custom resources',
        category: 'Navigation',
        action: () => openNamespaceTab('custom'),
        keywords: ['custom', 'resources', 'crs'],
      },
      {
        id: 'namespace-helm',
        label: 'Namespace - Helm',
        description: 'View Helm releases',
        category: 'Navigation',
        action: () => openNamespaceTab('helm'),
        keywords: ['helm', 'charts', 'releases'],
      },
      {
        id: 'namespace-events',
        label: 'Namespace - Events',
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

      return {
        id: `kubeconfig-${configValue}`,
        label: config.context,
        description:
          config.name !== config.context ? `From ${config.name}` : 'Switch to this context',
        category: 'Kubeconfigs',
        icon: isActive ? '✓' : undefined,
        action: () => {
          if (isActive) {
            setActiveKubeconfig(configValue);
            return;
          }
          void setSelectedKubeconfigs([...selectedKubeconfigs, configValue]);
        },
        keywords: ['kubeconfig', 'context', config.name, config.context],
      };
    });
  }, [kubeconfigs, selectedKubeconfigs, setActiveKubeconfig, setSelectedKubeconfigs]);

  // Order: Application, Settings, Navigation (including namespace views), Kubeconfigs, Namespaces
  return [...commands, ...namespaceviewCommands, ...namespaceCommands, ...kubeconfigCommands];
}
