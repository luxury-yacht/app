/**
 * frontend/src/modules/namespace/contexts/NsResourcesContext.tsx
 *
 * Effects wrapper for the namespace views: publishes the selected namespace
 * to the refresh orchestrator and primes single-namespace permission checks.
 *
 * This deliberately holds NO domain leases, fetches NO data, and exposes NO
 * context value. Row data for every namespace tab is owned by the
 * query-backed tables, which hold their own base-scope lifecycle leases; the
 * active tab lives in ViewStateContext, which publishes it to the
 * orchestrator itself.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import type React from 'react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { queryNamespacePermissions } from '@/core/capabilities';
import { selectorForNamespaceSelection } from '@/core/refresh/scopeSelector';

// Extracts the concrete namespace name for capability checks; the
// all-namespaces sentinel has no single namespace to query.
// The single namespace a selection names for permission queries; null for all namespaces.
const getCapabilityNamespace = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const selector = selectorForNamespaceSelection(trimmed);
  return selector.kind === 'namespace' ? selector.namespace : null;
};

interface NamespaceResourcesProviderProps {
  children: ReactNode;
  namespace?: string | null;
}

export const NamespaceResourcesProvider: React.FC<NamespaceResourcesProviderProps> = ({
  children,
  namespace,
}) => {
  const { selectedClusterId } = useKubeconfig();
  const { selectedNamespaceClusterId } = useNamespace();
  // Prefer the cluster tied to the namespace selection; fall back to the kubeconfig selection.
  const namespaceClusterId = selectedNamespaceClusterId ?? selectedClusterId;
  const currentNamespace = namespace ?? null;

  // Single-namespace permission query.
  useEffect(() => {
    const capabilityNamespace = getCapabilityNamespace(currentNamespace);
    if (!capabilityNamespace) {
      return;
    }
    queryNamespacePermissions(capabilityNamespace, namespaceClusterId ?? null);
  }, [currentNamespace, namespaceClusterId]);

  return <>{children}</>;
};
