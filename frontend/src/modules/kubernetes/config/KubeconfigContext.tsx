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
  useRef,
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

const hasWindowsDrivePrefix = (value: string): boolean => {
  if (!value || value.length < 2) {
    return false;
  }
  const first = value[0];
  const isAlpha = (first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z');
  if (!isAlpha || value[1] !== ':') {
    return false;
  }
  if (value.length === 2) {
    return true;
  }
  return value[2] !== ':';
};

const splitSelectionComponents = (selection: string): { path: string; context: string } => {
  const trimmed = selection.trim();
  if (!trimmed) {
    return { path: '', context: '' };
  }
  const startIndex = hasWindowsDrivePrefix(trimmed) ? 2 : 0;
  const delimiterIndex = trimmed.indexOf(':', startIndex);
  if (delimiterIndex === -1) {
    return { path: trimmed, context: '' };
  }
  return {
    path: trimmed.slice(0, delimiterIndex),
    context: trimmed.slice(delimiterIndex + 1),
  };
};

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
  const selectionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const kubeconfigsRef = useRef<types.KubeconfigInfo[]>([]);
  const selectedKubeconfigsRef = useRef<string[]>([]);
  const selectedKubeconfigRef = useRef<string>('');
  // Prevent refresh context churn until the backend confirms selection updates.
  const selectionPendingRef = useRef(false);

  // Resolve cluster identity metadata from the current selection and config list.
  const resolveClusterMeta = useCallback((selection: string, configs: types.KubeconfigInfo[]) => {
    const trimmed = selection.trim();
    if (!trimmed) {
      return { id: '', name: '' };
    }

    const { path, context } = splitSelectionComponents(trimmed);

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

  useEffect(() => {
    kubeconfigsRef.current = kubeconfigs;
  }, [kubeconfigs]);

  useEffect(() => {
    selectedKubeconfigsRef.current = selectedKubeconfigs;
  }, [selectedKubeconfigs]);

  useEffect(() => {
    selectedKubeconfigRef.current = selectedKubeconfig;
  }, [selectedKubeconfig]);

  const getClusterMeta = useCallback(
    (selection: string) => resolveClusterMeta(selection, kubeconfigs),
    [resolveClusterMeta, kubeconfigs]
  );

  const normalizeSelections = useCallback((selections: string[]) => {
    const deduped: string[] = [];
    const seenSelections = new Set<string>();

    selections.forEach((selection) => {
      const trimmed = selection.trim();
      if (!trimmed) {
        return;
      }

      // Dedupe by full selection string (path:context) to allow the same context name
      // from different kubeconfig files (e.g., "dev" in both ~/.kube/config and ~/.kube/staging).
      if (seenSelections.has(trimmed)) {
        return;
      }
      seenSelections.add(trimmed);

      deduped.push(trimmed);
    });

    return deduped;
  }, []);

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

  const updateRefreshContext = useCallback(
    (meta: { id: string; name: string }, clusterIds: string[]) => {
      // Foreground view-specific domains only refresh for the active cluster.
      const foregroundClusterIds = meta.id ? [meta.id] : [];
      // System domains and the background refresher use all clusters when background refresh is on.
      const allConnectedClusterIds = backgroundRefreshEnabled ? clusterIds : foregroundClusterIds;
      refreshOrchestrator.updateContext({
        selectedClusterId: meta.id || undefined,
        selectedClusterName: meta.name || undefined,
        selectedClusterIds: foregroundClusterIds,
        allConnectedClusterIds,
      });
    },
    [backgroundRefreshEnabled]
  );

  // Keep refresh context aligned with the active kubeconfig selection.
  useEffect(() => {
    if (selectionPendingRef.current) {
      return;
    }
    updateRefreshContext(selectedClusterMeta, selectedClusterIds);
  }, [selectedClusterIds, selectedClusterMeta, updateRefreshContext]);

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
      const normalizedSelection = normalizeSelections(currentSelection || []);
      selectedKubeconfigsRef.current = normalizedSelection;
      selectedKubeconfigRef.current = normalizedSelection[0] || '';
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

  const applySelectedKubeconfigs = useCallback(
    async (configs: string[]) => {
      const previousSelections = selectedKubeconfigsRef.current;
      const previousActive = selectedKubeconfigRef.current;
      const normalizedSelections = normalizeSelections(configs);
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
      const selectionChanged =
        normalizedSelections.length !== previousSelections.length ||
        normalizedSelections.some((selection, index) => selection !== previousSelections[index]);
      const shouldEmitChanging = willBeEmpty;
      const shouldEmitChanged = !willBeEmpty && wasEmpty;
      const shouldEmitSelectionChanged = selectionChanged && !willBeEmpty;
      try {
        selectionPendingRef.current = true;
        // Keep refs in sync immediately so queued requests read the latest state.
        selectedKubeconfigsRef.current = normalizedSelections;
        selectedKubeconfigRef.current = nextActive;

        // Optimistically update the UI immediately so the dropdown reflects the intent.
        setSelectedKubeconfigsState(normalizedSelections);
        setSelectedKubeconfigState(nextActive);

        // Follow the required order while keeping per-tab state intact.
        // 1. Show the loading spinner (handled by kubeconfig:changing event)
        // 2. Cancel any refresh in progress (also handled by kubeconfig:changing event)
        if (shouldEmitChanging) {
          eventBus.emit('kubeconfig:changing', '');
        }

        // Perform the actual kubeconfig switch.
        await SetSelectedKubeconfigs(normalizedSelections);

        // Emit after backend updates to avoid refreshing with inactive clusters.
        if (shouldEmitSelectionChanged) {
          eventBus.emit('kubeconfig:selection-changed');
        }
        selectionPendingRef.current = false;
        const nextMeta = resolveClusterMeta(nextActive, kubeconfigsRef.current);
        const nextClusterIds = new Set<string>();
        normalizedSelections.forEach((selection) => {
          const meta = resolveClusterMeta(selection, kubeconfigsRef.current);
          if (meta.id) {
            nextClusterIds.add(meta.id);
          }
        });
        // Push refresh context after the backend activates the new selection.
        updateRefreshContext(nextMeta, Array.from(nextClusterIds));

        // 4. Perform a manual refresh (will be triggered by kubeconfig:changed event).
        if (shouldEmitChanged) {
          eventBus.emit('kubeconfig:changed', '');
        }
      } catch (error) {
        selectionPendingRef.current = false;
        // Roll back the UI to the previous value if the backend switch failed.
        selectedKubeconfigsRef.current = previousSelections;
        selectedKubeconfigRef.current = previousActive;
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
    [normalizeSelections, resolveClusterMeta, updateRefreshContext]
  );

  const setSelectedKubeconfigs = useCallback(
    (configs: string[]) => {
      // Serialize selection changes to avoid overlapping refresh subsystem rebuilds.
      const queued = selectionQueueRef.current.then(() => applySelectedKubeconfigs(configs));
      selectionQueueRef.current = queued.catch(() => undefined);
      return queued;
    },
    [applySelectedKubeconfigs]
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
      selectedKubeconfigRef.current = config;
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
      await runGridTableGC({ activeClusterHashes: hashes });
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
