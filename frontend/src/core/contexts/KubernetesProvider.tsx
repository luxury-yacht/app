/**
 * frontend/src/core/contexts/KubernetesProvider.tsx
 *
 * Composite provider for Kubernetes-related contexts.
 * Replaces the monolithic KubernetesDataContext with smaller, focused contexts.
 */
import React, { ReactNode } from 'react';
import { KubeconfigProvider } from '@modules/kubernetes/config/KubeconfigContext';
import { NamespaceProvider } from '@modules/namespace/contexts/NamespaceContext';
import { ViewStateProvider, useViewState } from './ViewStateContext';
import { ThemeProvider } from './ThemeContext';
import { RefreshManagerProvider } from '@/core/refresh/contexts/RefreshManagerContext';
import { useBackgroundClusterRefresh } from '@/core/refresh/hooks/useBackgroundClusterRefresh';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';

interface KubernetesProviderProps {
  children: ReactNode;
}

/**
 * Bridge component that wires up background cluster refresh.
 * Must be mounted inside both ViewStateProvider and NamespaceProvider
 * so it can access per-cluster navigation state and namespace selections.
 */
const BackgroundClusterRefreshBridge: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { getClusterNavigationState } = useViewState();
  const { getClusterNamespace } = useNamespace();

  useBackgroundClusterRefresh({
    getClusterNavigationState,
    getClusterNamespace,
  });

  return <>{children}</>;
};

/**
 * Composite provider that wraps all Kubernetes-related contexts.
 * This replaces the monolithic KubernetesDataContext with smaller, focused contexts.
 *
 * Benefits:
 * - Reduced re-renders: Components only re-render when their specific data changes
 * - Better performance: Smaller context updates = faster reconciliation
 * - Clearer dependencies: Easy to see what data each component needs
 * - Easier testing: Smaller contexts are easier to mock
 */
export const KubernetesProvider: React.FC<KubernetesProviderProps> = ({ children }) => {
  return (
    <ThemeProvider>
      <RefreshManagerProvider>
        <KubeconfigProvider>
          <ViewStateProvider>
            <NamespaceProvider>
              <BackgroundClusterRefreshBridge>{children}</BackgroundClusterRefreshBridge>
            </NamespaceProvider>
          </ViewStateProvider>
        </KubeconfigProvider>
      </RefreshManagerProvider>
    </ThemeProvider>
  );
};
