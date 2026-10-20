/**
 * frontend/src/core/contexts/KubernetesProvider.tsx
 *
 * Composite provider for Kubernetes-related contexts.
 * Replaces the monolithic KubernetesDataContext with smaller, focused contexts.
 */

import { KubeconfigProvider } from '@modules/kubernetes/config/KubeconfigContext';
import { NamespaceProvider } from '@modules/namespace/contexts/NamespaceContext';
import type React from 'react';
import type { ReactNode } from 'react';
import { useDocumentVisibilityEvents } from '@/core/refresh/hooks/useDocumentVisibilityEvents';
import { AppearanceModeProvider } from './AppearanceModeContext';
import { ClusterLifecycleProvider } from './ClusterLifecycleContext';
import { ViewStateProvider } from './ViewStateContext';

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
  useDocumentVisibilityEvents();
  return (
    <AppearanceModeProvider>
      <KubeconfigProvider>
        <ViewStateProvider>
          <ClusterLifecycleProvider>
            <NamespaceProvider>{children}</NamespaceProvider>
          </ClusterLifecycleProvider>
        </ViewStateProvider>
      </KubeconfigProvider>
    </AppearanceModeProvider>
  );
};
