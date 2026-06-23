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
import { SetSelectedKubeconfigs, SetVisibleCluster } from '@wailsjs/go/backend/App';
import { EventsOn } from '@wailsjs/runtime/runtime';
import { errorHandler } from '@utils/errorHandler';
import { types } from '@wailsjs/go/models';
import { readKubeconfigs, readSelectedKubeconfigs, requestAppState } from '@/core/app-state-access';
import {
  computeClusterHashes,
  runGridTableGC,
} from '@shared/components/tables/persistence/gridTablePersistenceGC';
import { eventBus, useEventBus } from '@/core/events';
import { refreshOrchestrator, useBackgroundRefresh } from '@/core/refresh';
import {
  getClusterTabOrder,
  getNextClusterTabSelectionAfterClose,
} from '@core/persistence/clusterTabOrder';

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
  openKubeconfig: (selection: string) => Promise<void>;
  closeKubeconfig: (selectionOrClusterId: string) => Promise<void>;
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

type SelectionTransitionOptions = {
  configs: string[];
  requestId: number;
  activeSelection?: string;
  context: string;
  errorMessage: string;
};

export const KubeconfigProvider: React.FC<KubeconfigProviderProps> = ({ children }) => {
  const [kubeconfigs, setKubeconfigs] = useState<types.KubeconfigInfo[]>([]);
  const [selectedKubeconfigs, setSelectedKubeconfigsState] = useState<string[]>([]);
  const [selectedKubeconfig, setSelectedKubeconfigState] = useState<string>('');
  const [committedSelectedKubeconfigs, setCommittedSelectedKubeconfigs] = useState<string[]>([]);
  const [committedSelectedKubeconfig, setCommittedSelectedKubeconfig] = useState<string>('');
  const [kubeconfigsLoading, setKubeconfigsLoading] = useState(false);
  const { enabled: backgroundRefreshEnabled } = useBackgroundRefresh();
  const kubeconfigsRef = useRef<types.KubeconfigInfo[]>([]);
  const selectedKubeconfigsRef = useRef<string[]>([]);
  const selectedKubeconfigRef = useRef<string>('');
  const committedSelectionsRef = useRef<string[]>([]);
  const committedActiveRef = useRef<string>('');
  const latestSelectionRequestIdRef = useRef(0);
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

  // Public selection follows the active tab immediately; refresh context below
  // stays on committed backend selections until cluster activation completes.
  const selectedClusterMeta = useMemo(
    () => resolveClusterMeta(selectedKubeconfig, kubeconfigs),
    [resolveClusterMeta, selectedKubeconfig, kubeconfigs]
  );

  const committedSelectedClusterMeta = useMemo(
    () => resolveClusterMeta(committedSelectedKubeconfig, kubeconfigs),
    [resolveClusterMeta, committedSelectedKubeconfig, kubeconfigs]
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

  const committedSelectedClusterIds = useMemo(() => {
    const ids = new Set<string>();
    committedSelectedKubeconfigs.forEach((selection) => {
      const id = resolveClusterMeta(selection, kubeconfigs).id;
      if (id) {
        ids.add(id);
      }
    });
    return Array.from(ids);
  }, [committedSelectedKubeconfigs, kubeconfigs, resolveClusterMeta]);

  const updateRefreshContext = useCallback(
    (meta: { id: string; name: string }, clusterIds: string[]) => {
      // Foreground view-specific domains only refresh for the active cluster.
      const foregroundClusterIds = meta.id ? [meta.id] : [];
      // Tell the backend resource governor which cluster is now visible so it can
      // keep that cluster (plus a small warm set) running fully and cool the rest
      // to bound RAM. Fire-and-forget: tiering is best-effort orchestration.
      if (meta.id) {
        void SetVisibleCluster(meta.id).catch(() => {
          // Governor signalling is non-critical; ignore transient binding errors.
        });
      }
      refreshOrchestrator.updateContext({
        selectedClusterId: meta.id || undefined,
        selectedClusterName: meta.name || undefined,
        selectedClusterIds: foregroundClusterIds,
        // This is the open/connected cluster set used for runtime disposal.
        // Background refresh eligibility is controlled separately by
        // useBackgroundClusterRefresh, so disabling background refresh must not
        // make inactive open tabs look disconnected.
        allConnectedClusterIds: clusterIds,
        backgroundRefreshEnabled,
      });
    },
    [backgroundRefreshEnabled]
  );

  // Keep refresh context aligned with the active kubeconfig selection.
  useEffect(() => {
    if (selectionPendingRef.current) {
      return;
    }
    updateRefreshContext(committedSelectedClusterMeta, committedSelectedClusterIds);
  }, [committedSelectedClusterIds, committedSelectedClusterMeta, updateRefreshContext]);

  const loadKubeconfigs = useCallback(async () => {
    setKubeconfigsLoading(true);
    try {
      // Load both the list of configs and the currently selected list.
      const [configs, currentSelection] = await Promise.all([
        requestAppState({
          resource: 'kubeconfigs',
          read: () => readKubeconfigs(),
        }),
        requestAppState({
          resource: 'selected-kubeconfigs',
          read: () => readSelectedKubeconfigs(),
        }),
      ]);

      setKubeconfigs(configs || []);

      // Set the selection from the backend
      const normalizedSelection = normalizeSelections(currentSelection || []);
      selectedKubeconfigsRef.current = normalizedSelection;
      selectedKubeconfigRef.current = normalizedSelection[0] || '';
      committedSelectionsRef.current = normalizedSelection;
      committedActiveRef.current = normalizedSelection[0] || '';
      setSelectedKubeconfigsState(normalizedSelection);
      setSelectedKubeconfigState(normalizedSelection[0] || '');
      setCommittedSelectedKubeconfigs(normalizedSelection);
      setCommittedSelectedKubeconfig(normalizedSelection[0] || '');
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

  const buildClusterIdList = useCallback(
    (selections: string[]) => {
      const ids = new Set<string>();
      selections.forEach((selection) => {
        const meta = resolveClusterMeta(selection, kubeconfigsRef.current);
        if (meta.id) {
          ids.add(meta.id);
        }
      });
      return Array.from(ids);
    },
    [resolveClusterMeta]
  );

  const resolveNextActiveSelection = useCallback(
    (
      previousSelections: string[],
      previousActive: string,
      normalizedSelections: string[],
      activeSelection?: string
    ) => {
      if (activeSelection !== undefined) {
        return normalizedSelections.includes(activeSelection) ? activeSelection : '';
      }

      const addedSelections = normalizedSelections.filter(
        (selection) => !previousSelections.includes(selection)
      );
      if (addedSelections.length > 0) {
        return addedSelections[addedSelections.length - 1];
      }

      if (previousActive && !normalizedSelections.includes(previousActive)) {
        const removedSelections = previousSelections.filter(
          (selection) => !normalizedSelections.includes(selection)
        );
        if (removedSelections.length === 1) {
          const nextAfterClose = getNextClusterTabSelectionAfterClose(
            previousSelections,
            removedSelections[0],
            previousActive,
            getClusterTabOrder()
          );
          if (nextAfterClose && normalizedSelections.includes(nextAfterClose)) {
            return nextAfterClose;
          }
        }
        return normalizedSelections[0] || '';
      }

      if (previousActive && normalizedSelections.includes(previousActive)) {
        return previousActive;
      }
      return normalizedSelections[0] || '';
    },
    []
  );

  const applySelectionTransition = useCallback(
    async ({
      configs,
      requestId,
      activeSelection,
      context,
      errorMessage,
    }: SelectionTransitionOptions) => {
      const previousSelections = selectedKubeconfigsRef.current;
      const previousActive = selectedKubeconfigRef.current;
      const normalizedSelections = normalizeSelections(configs);
      const nextActive = resolveNextActiveSelection(
        previousSelections,
        previousActive,
        normalizedSelections,
        activeSelection
      );
      const wasEmpty = previousSelections.length === 0;
      const willBeEmpty = normalizedSelections.length === 0;
      const selectionChanged =
        normalizedSelections.length !== previousSelections.length ||
        normalizedSelections.some((selection, index) => selection !== previousSelections[index]);
      const shouldEmitChanging = selectionChanged && willBeEmpty;
      const shouldEmitChanged = !willBeEmpty && wasEmpty;
      const shouldEmitSelectionChanged = selectionChanged && !willBeEmpty;
      const nextMeta = resolveClusterMeta(nextActive, kubeconfigsRef.current);
      const nextClusterIds = buildClusterIdList(normalizedSelections);

      try {
        selectionPendingRef.current = true;
        // Keep refs in sync immediately so superseding requests read the latest state.
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

        // A newer intent has already been issued; ignore stale completion.
        if (requestId !== latestSelectionRequestIdRef.current) {
          return;
        }

        // Emit after backend updates to avoid refreshing with inactive clusters.
        if (shouldEmitSelectionChanged) {
          eventBus.emit('kubeconfig:selection-changed');
        }
        selectionPendingRef.current = false;
        // Publish cluster-data identities only after the backend activates the
        // matching client pool and refresh subsystems.
        committedSelectionsRef.current = normalizedSelections;
        committedActiveRef.current = nextActive;
        setCommittedSelectedKubeconfigs(normalizedSelections);
        setCommittedSelectedKubeconfig(nextActive);
        updateRefreshContext(nextMeta, nextClusterIds);

        // 4. Perform a manual refresh (will be triggered by kubeconfig:changed event).
        if (shouldEmitChanged) {
          eventBus.emit('kubeconfig:changed', '');
        }
      } catch (error) {
        // Ignore stale errors from superseded requests.
        if (requestId !== latestSelectionRequestIdRef.current) {
          return;
        }
        selectionPendingRef.current = false;
        // Roll back to the last committed backend selection.
        let rollbackSelections = committedSelectionsRef.current;
        let rollbackActive = committedActiveRef.current;
        try {
          const confirmed = normalizeSelections(
            (await requestAppState({
              resource: 'selected-kubeconfigs',
              read: () => readSelectedKubeconfigs(),
            })) || []
          );
          rollbackSelections = confirmed;
          rollbackActive =
            rollbackActive && confirmed.includes(rollbackActive)
              ? rollbackActive
              : confirmed[0] || '';
        } catch {
          // Keep last committed in-memory snapshot when backend confirmation fails.
        }
        committedSelectionsRef.current = rollbackSelections;
        committedActiveRef.current = rollbackActive;
        selectedKubeconfigsRef.current = rollbackSelections;
        selectedKubeconfigRef.current = rollbackActive;
        setSelectedKubeconfigsState(rollbackSelections);
        setSelectedKubeconfigState(rollbackActive);
        setCommittedSelectedKubeconfigs(rollbackSelections);
        setCommittedSelectedKubeconfig(rollbackActive);
        errorHandler.handle(
          error,
          {
            context,
            configs: normalizedSelections,
          },
          errorMessage
        );
        throw error;
      }
    },
    [
      buildClusterIdList,
      normalizeSelections,
      resolveClusterMeta,
      resolveNextActiveSelection,
      updateRefreshContext,
    ]
  );

  const setSelectedKubeconfigs = useCallback(
    (configs: string[]) => {
      const requestId = latestSelectionRequestIdRef.current + 1;
      latestSelectionRequestIdRef.current = requestId;
      return applySelectionTransition({
        configs,
        requestId,
        context: 'setSelectedKubeconfigs',
        errorMessage: 'Failed to set kubeconfigs',
      });
    },
    [applySelectionTransition]
  );

  const setSelectedKubeconfig = useCallback(
    async (config: string) => {
      await setSelectedKubeconfigs(config ? [config] : []);
    },
    [setSelectedKubeconfigs]
  );

  const openKubeconfig = useCallback(
    async (selection: string) => {
      const target = selection.trim();
      if (!target) {
        return;
      }

      const requestId = latestSelectionRequestIdRef.current + 1;
      latestSelectionRequestIdRef.current = requestId;

      const previousSelections = selectedKubeconfigsRef.current;
      const nextSelections = previousSelections.includes(target)
        ? previousSelections
        : [...previousSelections, target];
      await applySelectionTransition({
        configs: nextSelections,
        requestId,
        activeSelection: target,
        context: 'openKubeconfig',
        errorMessage: 'Failed to open cluster',
      });
    },
    [applySelectionTransition]
  );

  const closeKubeconfig = useCallback(
    async (selectionOrClusterId: string) => {
      const target = selectionOrClusterId.trim();
      if (!target) {
        return;
      }

      const requestId = latestSelectionRequestIdRef.current + 1;
      latestSelectionRequestIdRef.current = requestId;

      const previousSelections = selectedKubeconfigsRef.current;
      const matchesTarget = (selection: string) => {
        if (selection === target) {
          return true;
        }
        return resolveClusterMeta(selection, kubeconfigsRef.current).id === target;
      };
      const normalizedSelections = normalizeSelections(
        previousSelections.filter((selection) => !matchesTarget(selection))
      );
      await applySelectionTransition({
        configs: normalizedSelections,
        requestId,
        context: 'closeKubeconfig',
        errorMessage: 'Failed to close cluster',
      });
    },
    [applySelectionTransition, normalizeSelections, resolveClusterMeta]
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
      if (committedSelectionsRef.current.includes(config)) {
        committedActiveRef.current = config;
        setCommittedSelectedKubeconfig(config);
      }
    },
    [selectedKubeconfig, selectedKubeconfigs]
  );

  // Load kubeconfigs on mount
  useEffect(() => {
    loadKubeconfigs();
  }, [loadKubeconfigs]);

  // Listen for backend kubeconfig watcher refresh events.
  useEffect(() => {
    const cancel = EventsOn('kubeconfig:available-changed', () => {
      void loadKubeconfigs();
    });

    return () => {
      if (typeof cancel === 'function') {
        cancel();
      }
    };
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
      openKubeconfig,
      closeKubeconfig,
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
      openKubeconfig,
      closeKubeconfig,
      setActiveKubeconfig,
      getClusterMeta,
      loadKubeconfigs,
    ]
  );

  return <KubeconfigContext.Provider value={contextValue}>{children}</KubeconfigContext.Provider>;
};
