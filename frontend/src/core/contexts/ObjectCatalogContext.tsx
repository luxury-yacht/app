/**
 * frontend/src/core/contexts/ObjectCatalogContext.tsx
 *
 * Object catalog diagnostics context and refresh helper.
 * Provides diagnostics information about the object catalog feature,
 * including whether it is enabled, loading state, and error handling.
 * Also includes a refresh function to re-fetch the diagnostics data.
 */
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { GetCatalogDiagnostics } from '@wailsjs/go/backend/App';
import type { backend } from '@wailsjs/go/models';

interface ObjectCatalogContextValue {
  loading: boolean;
  error: string | null;
  diagnostics: backend.CatalogDiagnostics | null;
  enabled: boolean;
  refresh: () => Promise<void>;
}

const ObjectCatalogContext = createContext<ObjectCatalogContextValue | undefined>(undefined);

interface ObjectCatalogProviderProps {
  children: ReactNode;
}

export const ObjectCatalogProvider: React.FC<ObjectCatalogProviderProps> = ({ children }) => {
  const [diagnostics, setDiagnostics] = useState<backend.CatalogDiagnostics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await GetCatalogDiagnostics();
      setDiagnostics(result ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (loading || error || diagnostics?.enabled) {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      void refresh();
    }, 1000);

    return () => {
      window.clearTimeout(retryTimer);
    };
  }, [diagnostics?.enabled, error, loading, refresh]);

  const value = useMemo<ObjectCatalogContextValue>(() => {
    const enabled = diagnostics?.enabled ?? false;
    return {
      loading,
      error,
      diagnostics,
      enabled,
      refresh,
    };
  }, [diagnostics, error, loading, refresh]);

  return <ObjectCatalogContext.Provider value={value}>{children}</ObjectCatalogContext.Provider>;
};
