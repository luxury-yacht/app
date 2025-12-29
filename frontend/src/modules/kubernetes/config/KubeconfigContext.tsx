/**
 * frontend/src/modules/kubernetes/config/KubeconfigContext.tsx
 *
 * Context and provider for KubeconfigContext.
 * Defines shared state and accessors for the kubernetes feature.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  ReactNode,
} from 'react';
import {
  GetKubeconfigs,
  GetSelectedKubeconfigs,
  SetSelectedKubeconfigs,
} from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { types } from '@wailsjs/go/models';
import {
  computeClusterHashes,
  runGridTableGC,
} from '@shared/components/tables/persistence/gridTablePersistenceGC';
import { eventBus, useEventBus } from '@/core/events';
import { refreshOrchestrator, useBackgroundRefresh } from '@/core/refresh';

interface KubeconfigContextType {
  kubeconfigs: types.KubeconfigInfo[];
  selectedKubeconfigs: string[];
  selectedKubeconfig: string;
  selectedClusterId: string;
  selectedClusterName: string;
  selectedClusterIds: string[];
  kubeconfigsLoading: boolean;
  setSelectedKubeconfigs: (configs: string[]) => Promise<void>;
  setSelectedKubeconfig: (config: string) => Promise<void>;
  setActiveKubeconfig: (config: string) => void;
  getClusterMeta: (config: string) => { id: string; name: string };
  loadKubeconfigs: () => Promise<void>;
}

const KubeconfigContext = createContext<KubeconfigContextType | undefined>(undefined);

export const useKubeconfig = () => {
  const context = useContext(KubeconfigContext);
  if (!context) {
    throw new Error('useKubeconfig must be used within KubeconfigProvider');
  }
  return context;
};

interface KubeconfigProviderProps {
  children: ReactNode;
}

export const KubeconfigProvider: React.FC<KubeconfigProviderProps> = ({ children }) => {
  const [kubeconfigs, setKubeconfigs] = useState<types.KubeconfigInfo[]>([]);
  const [selectedKubeconfigs, setSelectedKubeconfigsState] = useState<string[]>([]);
  const [selectedKubeconfig, setSelectedKubeconfigState] = useState<string>('');
  const [kubeconfigsLoading, setKubeconfigsLoading] = useState(false);
  const { enabled: backgroundRefreshEnabled } = useBackgroundRefresh();

  // Resolve cluster identity metadata from the current selection and config list.
  const resolveClusterMeta = useCallback((selection: string, configs: types.KubeconfigInfo[]) => {
    const trimmed = selection.trim();
    if (!trimmed) {
      return { id: '', name: '' };
    }

    const separatorIndex = trimmed.indexOf(':');
    const path = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed;
    const context = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : '';

    const match = configs.find((config) => config.path === path && config.context === context);
    if (match) {
      return { id: `${match.name}:${match.context}`, name: match.context };
    }

    const pathParts = path.split(/[/\\]/);
    const filename = pathParts[pathParts.length - 1] ?? '';
    if (!filename && !context) {
      return { id: '', name: '' };
    }
    if (!context) {
      return { id: filename, name: '' };
    }
    if (!filename) {
      return { id: context, name: context };
    }
    return { id: `${filename}:${context}`, name: context };
  }, []);

  const selectedClusterMeta = useMemo(
    () => resolveClusterMeta(selectedKubeconfig, kubeconfigs),
    [resolveClusterMeta, selectedKubeconfig, kubeconfigs]
  );

  const getClusterMeta = useCallback(
    (selection: string) => resolveClusterMeta(selection, kubeconfigs),
    [resolveClusterMeta, kubeconfigs]
  );

  const normalizeSelections = useCallback(
    (selections: string[], configs: types.KubeconfigInfo[]) => {
      const deduped: string[] = [];
      const seenContexts = new Set<string>();

      selections.forEach((selection) => {
        const trimmed = selection.trim();
        if (!trimmed) {
          return;
        }

        // Enforce a single active selection per context name.
        const contextName = resolveClusterMeta(trimmed, configs).name;
        if (contextName) {
          if (seenContexts.has(contextName)) {
            return;
          }
          seenContexts.add(contextName);
        }

        deduped.push(trimmed);
      });

      return deduped;
    },
    [resolveClusterMeta]
  );

  const selectedClusterIds = useMemo(() => {
    const ids = new Set<string>();
    selectedKubeconfigs.forEach((selection) => {
      const id = resolveClusterMeta(selection, kubeconfigs).id;
      if (id) {
        ids.add(id);
      }
    });
    return Array.from(ids);
  }, [kubeconfigs, resolveClusterMeta, selectedKubeconfigs]);

  // Keep refresh context aligned with the active kubeconfig selection.
  useEffect(() => {
    const refreshClusterIds = backgroundRefreshEnabled
      ? selectedClusterIds
      : selectedClusterMeta.id
        ? [selectedClusterMeta.id]
        : [];
    refreshOrchestrator.updateContext({
      selectedClusterId: selectedClusterMeta.id || undefined,
      selectedClusterName: selectedClusterMeta.name || undefined,
      selectedClusterIds: refreshClusterIds,
    });
  }, [
    backgroundRefreshEnabled,
    selectedClusterMeta.id,
    selectedClusterMeta.name,
    selectedClusterIds,
  ]);

  const loadKubeconfigs = useCallback(async () => {
    setKubeconfigsLoading(true);
    try {
      // Load both the list of configs and the currently selected list.
      const [configs, currentSelection] = await Promise.all([
        GetKubeconfigs(),
        GetSelectedKubeconfigs(),
      ]);

      setKubeconfigs(configs || []);

      // Set the selection from the backend
      const normalizedSelection = normalizeSelections(currentSelection || [], configs || []);
      setSelectedKubeconfigsState(normalizedSelection);
      setSelectedKubeconfigState(normalizedSelection[0] || '');
    } catch (error) {
      errorHandler.handle(
        error,
        {
          context: 'loadKubeconfigs',
        },
        'Failed to load kubeconfigs'
      );
      setKubeconfigs([]);
    } finally {
      setKubeconfigsLoading(false);
    }
  }, [normalizeSelections]);

  const setSelectedKubeconfigs = useCallback(
    async (configs: string[]) => {
      const previousSelections = selectedKubeconfigs;
      const previousActive = selectedKubeconfig;
      const normalizedSelections = normalizeSelections(configs, kubeconfigs);
      const removedActive = previousActive && !normalizedSelections.includes(previousActive);
      const addedSelections = normalizedSelections.filter(
        (selection) => !previousSelections.includes(selection)
      );
      const nextActive = addedSelections.length
        ? addedSelections[addedSelections.length - 1]
        : removedActive
          ? normalizedSelections[0] || ''
          : previousActive;
      const wasEmpty = previousSelections.length === 0;
      const willBeEmpty = normalizedSelections.length === 0;
      const shouldEmitChanging = willBeEmpty;
      const shouldEmitChanged = !willBeEmpty && wasEmpty;
      try {
        // Optimistically update the UI immediately so the dropdown reflects the intent.
        setSelectedKubeconfigsState(normalizedSelections);
        setSelectedKubeconfigState(nextActive);

        // Follow the required order while keeping per-tab state intact.
        // 1. Show the loading spinner (handled by kubeconfig:changing event)
        // 2. Cancel any refresh in progress (also handled by kubeconfig:changing event)
        if (shouldEmitChanging) {
          eventBus.emit('kubeconfig:changing', '');
        }

        // Perform the actual kubeconfig switch
        await SetSelectedKubeconfigs(normalizedSelections);

        // 4. Perform a manual refresh (will be triggered by kubeconfig:changed event)
        if (shouldEmitChanged) {
          eventBus.emit('kubeconfig:changed', '');
        }
      } catch (error) {
        // Roll back the UI to the previous value if the backend switch failed.
        setSelectedKubeconfigsState(previousSelections);
        setSelectedKubeconfigState(previousActive);
        errorHandler.handle(
          error,
          {
            context: 'setSelectedKubeconfigs',
            configs: normalizedSelections,
          },
          'Failed to set kubeconfigs'
        );
        throw error;
      }
    },
    [kubeconfigs, normalizeSelections, selectedKubeconfig, selectedKubeconfigs]
  );

  const setSelectedKubeconfig = useCallback(
    async (config: string) => {
      await setSelectedKubeconfigs(config ? [config] : []);
    },
    [setSelectedKubeconfigs]
  );

  const setActiveKubeconfig = useCallback(
    (config: string) => {
      if (!config || config === selectedKubeconfig) {
        return;
      }
      if (!selectedKubeconfigs.includes(config)) {
        return;
      }
      setSelectedKubeconfigState(config);
    },
    [selectedKubeconfig, selectedKubeconfigs]
  );

  // Load kubeconfigs on mount
  useEffect(() => {
    loadKubeconfigs();
  }, [loadKubeconfigs]);

  // Run GridTable persistence GC when kubeconfigs change or selection changes
  useEffect(() => {
    const runGC = async () => {
      const identities = new Set<string>();
      kubeconfigs.forEach((config) => {
        if (config.name && config.context) {
          identities.add(`${config.name}:${config.context}`);
        }
      });
      selectedClusterIds.forEach((id) => identities.add(id));
      const hashes = await computeClusterHashes(Array.from(identities));
      runGridTableGC({ activeClusterHashes: hashes });
    };

    void runGC();
  }, [kubeconfigs, selectedClusterIds]);

  // Listen for kubeconfig change events from command palette
  useEventBus(
    'kubeconfig:change-request',
    (newKubeconfig) => {
      if (newKubeconfig) {
        setSelectedKubeconfig(newKubeconfig);
      }
    },
    [setSelectedKubeconfig]
  );

  // Memoize context value
  const contextValue = useMemo(
    () => ({
      kubeconfigs,
      selectedKubeconfigs,
      selectedKubeconfig,
      selectedClusterId: selectedClusterMeta.id,
      selectedClusterName: selectedClusterMeta.name,
      selectedClusterIds,
      kubeconfigsLoading,
      setSelectedKubeconfigs,
      setSelectedKubeconfig,
      setActiveKubeconfig,
      getClusterMeta,
      loadKubeconfigs,
    }),
    [
      kubeconfigs,
      selectedKubeconfigs,
      selectedKubeconfig,
      selectedClusterMeta.id,
      selectedClusterMeta.name,
      selectedClusterIds,
      kubeconfigsLoading,
      setSelectedKubeconfigs,
      setSelectedKubeconfig,
      setActiveKubeconfig,
      getClusterMeta,
      loadKubeconfigs,
    ]
  );

  return <KubeconfigContext.Provider value={contextValue}>{children}</KubeconfigContext.Provider>;
};
