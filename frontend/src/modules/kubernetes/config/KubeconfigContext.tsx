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
import { GetKubeconfigs, GetSelectedKubeconfig, SetKubeconfig } from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';
import { types } from '@wailsjs/go/models';
import { useObjectPanelState } from '@/core/contexts/ObjectPanelStateContext';
import {
  computeClusterHashes,
  runGridTableGC,
} from '@shared/components/tables/persistence/gridTablePersistenceGC';
import { eventBus, useEventBus } from '@/core/events';

interface KubeconfigContextType {
  kubeconfigs: types.KubeconfigInfo[];
  selectedKubeconfig: string;
  kubeconfigsLoading: boolean;
  setSelectedKubeconfig: (config: string) => Promise<void>;
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
  const [selectedKubeconfig, setSelectedKubeconfigState] = useState<string>('');
  const [kubeconfigsLoading, setKubeconfigsLoading] = useState(false);
  const { onCloseObjectPanel } = useObjectPanelState();

  const loadKubeconfigs = useCallback(async () => {
    setKubeconfigsLoading(true);
    try {
      // Load both the list of configs and the currently selected one
      const [configs, currentSelection] = await Promise.all([
        GetKubeconfigs(),
        GetSelectedKubeconfig(),
      ]);

      setKubeconfigs(configs || []);

      // Set the selection from the backend
      if (currentSelection) {
        setSelectedKubeconfigState(currentSelection);
      }
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
  }, []);

  const setSelectedKubeconfig = useCallback(
    async (config: string) => {
      const previousSelection = selectedKubeconfig;
      try {
        onCloseObjectPanel();

        // Optimistically update the UI immediately so the dropdown reflects the intent.
        setSelectedKubeconfigState(config);

        // Follow the exact order from Cardinal Rules:

        // 1. Clear/reset all views and contexts
        eventBus.emit('view:reset');

        // 2. Show the loading spinner (handled by kubeconfig:changing event)
        // 3. Cancel any refresh in progress (also handled by kubeconfig:changing event)
        eventBus.emit('kubeconfig:changing', config);

        // Perform the actual kubeconfig switch
        await SetKubeconfig(config);

        // 4. Perform a manual refresh (will be triggered by kubeconfig:changed event)
        eventBus.emit('kubeconfig:changed', config);
      } catch (error) {
        // Roll back the UI to the previous value if the backend switch failed.
        setSelectedKubeconfigState(previousSelection);
        errorHandler.handle(
          error,
          {
            context: 'setKubeconfig',
            config,
          },
          'Failed to set kubeconfig'
        );
        throw error;
      }
    },
    [selectedKubeconfig, onCloseObjectPanel]
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
        if (config.path && config.context) {
          identities.add(`${config.path}:${config.context}`);
        }
      });
      if (selectedKubeconfig) {
        identities.add(selectedKubeconfig);
      }
      const hashes = await computeClusterHashes(Array.from(identities));
      runGridTableGC({ activeClusterHashes: hashes });
    };

    void runGC();
  }, [kubeconfigs, selectedKubeconfig]);

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
      selectedKubeconfig,
      kubeconfigsLoading,
      setSelectedKubeconfig,
      loadKubeconfigs,
    }),
    [kubeconfigs, selectedKubeconfig, kubeconfigsLoading, setSelectedKubeconfig, loadKubeconfigs]
  );

  return <KubeconfigContext.Provider value={contextValue}>{children}</KubeconfigContext.Provider>;
};
