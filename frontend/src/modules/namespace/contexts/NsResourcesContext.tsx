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
import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import { queryNamespacePermissions } from '@/core/capabilities';
import { refreshOrchestrator } from '@/core/refresh';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';

// Extracts the concrete namespace name for capability checks; the
// all-namespaces sentinel has no single namespace to query.
const getCapabilityNamespace = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('namespace:')) {
    const actual = trimmed.slice('namespace:'.length);
    return actual && actual !== 'all' ? actual : null;
  }
  return trimmed === 'all' ? null : trimmed;
};

interface NamespaceResourcesProviderProps {
  children: ReactNode;
  namespace?: string | null;
}

export const NamespaceResourcesProvider: React.FC<NamespaceResourcesProviderProps> = ({
  children,
  namespace,
}) => {
  const { viewType } = useViewState();
  const { selectedClusterId } = useKubeconfig();
  const { selectedNamespaceClusterId } = useNamespace();
  // Prefer the cluster tied to the namespace selection; fall back to the kubeconfig selection.
  const namespaceClusterId = selectedNamespaceClusterId ?? selectedClusterId;
  const isNamespaceView = viewType === 'namespace';
  const currentNamespace = namespace ?? null;

  // Publish the active namespace selection to the orchestrator: scope routing
  // and streaming gating across the refresh subsystem read it from context.
  useEffect(() => {
    if (!isNamespaceView) {
      refreshOrchestrator.updateContext({
        selectedNamespace: undefined,
        selectedNamespaceClusterId: undefined,
      });
      return;
    }
    refreshOrchestrator.updateContext({
      selectedNamespace: currentNamespace ?? undefined,
      selectedNamespaceClusterId: currentNamespace ? (namespaceClusterId ?? undefined) : undefined,
    });
  }, [currentNamespace, isNamespaceView, namespaceClusterId]);

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
