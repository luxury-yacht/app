/**
 * frontend/src/modules/namespace/components/NsResourcesManager.tsx
 *
 * Module source for NsResourcesManager.
 * Publishes the active namespace tab to NsResourcesContext and renders the
 * namespace views. Each tab's table owns its own data via the query-backed
 * grid (there is no context-held resource data to orchestrate).
 */
import React, { useEffect } from 'react';
import { useNamespaceResources } from '@modules/namespace/contexts/NsResourcesContext';
import NamespaceResourcesViews from '@modules/namespace/components/NsResourcesViews';
import { NamespaceViewType } from '@/types/navigation/views';

interface NamespaceResourcesManagerProps {
  namespace: string;
  activeTab?: NamespaceViewType;
  onTabChange?: (tab: NamespaceViewType) => void;
  objectPanel?: React.ReactNode;
  autoRefreshEnabled?: boolean;
  autoRefreshInterval?: number;
  resourceIntervals?: Record<string, number>;
}

export function NamespaceResourcesManager({
  namespace,
  activeTab,
  onTabChange,
  objectPanel,
}: NamespaceResourcesManagerProps) {
  const { setActiveResourceType } = useNamespaceResources();

  useEffect(() => {
    if (activeTab) {
      setActiveResourceType(activeTab);
    }
  }, [activeTab, setActiveResourceType]);

  return (
    <NamespaceResourcesViews
      namespace={namespace}
      activeTab={activeTab || 'workloads'}
      onTabChange={onTabChange}
      objectPanel={objectPanel}
    />
  );
}
