/**
 * frontend/src/core/contexts/KubernetesProvider.tsx
 *
 * Composite provider for Kubernetes-related contexts.
 * Replaces the monolithic KubernetesDataContext with smaller, focused contexts.
 */
import React, { ReactNode } from 'react';
import { KubeconfigProvider } from '@modules/kubernetes/config/KubeconfigContext';
import { NamespaceProvider } from '@modules/namespace/contexts/NamespaceContext';
import { ViewStateProvider } from './ViewStateContext';
import { ThemeProvider } from './ThemeContext';
import { RefreshManagerProvider } from '@/core/refresh/contexts/RefreshManagerContext';
import { ObjectCatalogProvider } from './ObjectCatalogContext';

interface KubernetesProviderProps {
  children: ReactNode;
}

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
        <ObjectCatalogProvider>
          <ViewStateProvider>
            <KubeconfigProvider>
              <NamespaceProvider>{children}</NamespaceProvider>
            </KubeconfigProvider>
          </ViewStateProvider>
        </ObjectCatalogProvider>
      </RefreshManagerProvider>
    </ThemeProvider>
  );
};
