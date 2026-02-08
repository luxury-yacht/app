/**
 * frontend/src/modules/cluster/components/ClusterResourcesViews.tsx
 *
 * Component to display various cluster resource views based on the active tab.
 * Each view handles its own data, loading state, and error handling.
 */

import React from 'react';
import { ClusterViewType } from '@ui/navigation/types';
import ClusterViewNodes from '@modules/cluster/components/ClusterViewNodes';
import ClusterViewRBAC from '@modules/cluster/components/ClusterViewRBAC';
import ClusterViewStorage from '@modules/cluster/components/ClusterViewStorage';
import ClusterViewConfig from '@modules/cluster/components/ClusterViewConfig';
import ClusterViewCRDs from '@modules/cluster/components/ClusterViewCRDs';
import ClusterViewCustom from '@modules/cluster/components/ClusterViewCustom';
import ClusterViewEvents from '@modules/cluster/components/ClusterViewEvents';

interface ClusterResourcesViewsProps {
  // Resource data and loading states
  nodes?: any[];
  nodesLoading?: boolean;
  nodesError?: string | null;
  nodesLoaded?: boolean;

  config?: any[];
  configLoading?: boolean;
  configError?: string | null;
  configLoaded?: boolean;

  crds?: any[];
  crdsLoading?: boolean;
  crdsError?: string | null;
  crdsLoaded?: boolean;

  custom?: any[];
  customLoading?: boolean;
  customError?: string | null;
  customLoaded?: boolean;

  events?: any[];
  eventsLoading?: boolean;
  eventsError?: string | null;
  eventsLoaded?: boolean;

  rbac?: any[];
  rbacLoading?: boolean;
  rbacError?: string | null;
  rbacLoaded?: boolean;

  storage?: any[];
  storageLoading?: boolean;
  storageError?: string | null;
  storageLoaded?: boolean;

  // Tab control from parent
  activeTab?: ClusterViewType | null;
  onTabChange?: (tab: ClusterViewType) => void;

  // Object panel element to render
  objectPanel?: React.ReactNode;
}

function ClusterResourcesViews({
  nodes = [],
  nodesLoading = false,
  nodesError = null,
  nodesLoaded = false,

  config = [],
  configLoading = false,
  configError = null,
  configLoaded = false,

  crds = [],
  crdsLoading = false,
  crdsError = null,
  crdsLoaded = false,

  custom = [],
  customLoading = false,
  customError = null,
  customLoaded = false,

  events = [],
  eventsLoading = false,
  eventsError = null,
  eventsLoaded = false,

  rbac = [],
  rbacLoading = false,
  rbacError = null,
  rbacLoaded = false,

  storage = [],
  storageLoading = false,
  storageError = null,
  storageLoaded = false,

  activeTab: controlledActiveTab,
  onTabChange: _onTabChangeCallback,
  objectPanel,
}: ClusterResourcesViewsProps) {
  const activeTab = controlledActiveTab ?? null;

  // Render content based on active tab
  const renderTabContent = () => {
    if (!activeTab) {
      return null;
    }

    switch (activeTab) {
      case 'nodes':
        return (
          <ClusterViewNodes
            data={nodes}
            loading={nodesLoading}
            loaded={nodesLoaded}
            error={nodesError}
          />
        );
      case 'config':
        return (
          <ClusterViewConfig
            data={config}
            loading={configLoading}
            loaded={configLoaded}
            error={configError}
          />
        );
      case 'crds':
        return (
          <ClusterViewCRDs
            data={crds}
            loading={crdsLoading}
            loaded={crdsLoaded}
            error={crdsError}
          />
        );
      case 'custom':
        return (
          <ClusterViewCustom
            data={custom}
            loading={customLoading}
            loaded={customLoaded}
            error={customError}
          />
        );
      case 'events':
        return (
          <ClusterViewEvents
            data={events}
            loading={eventsLoading}
            loaded={eventsLoaded}
            error={eventsError}
          />
        );
      case 'rbac':
        return (
          <ClusterViewRBAC
            data={rbac}
            loading={rbacLoading}
            loaded={rbacLoaded}
            error={rbacError}
          />
        );
      case 'storage':
        return (
          <ClusterViewStorage
            data={storage}
            loading={storageLoading}
            loaded={storageLoaded}
            error={storageError}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="view-content">
      {renderTabContent()}
      {objectPanel}
    </div>
  );
}

export default React.memo(ClusterResourcesViews);
