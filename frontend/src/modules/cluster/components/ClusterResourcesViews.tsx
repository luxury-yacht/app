/**
 * frontend/src/modules/cluster/components/ClusterResourcesViews.tsx
 *
 * Component to display various cluster resource views based on the active tab.
 * Each view handles its own data, loading state, and error handling.
 */

import ClusterViewAttention from '@modules/cluster/components/ClusterViewAttention';
import ClusterViewConfig from '@modules/cluster/components/ClusterViewConfig';
import ClusterViewCRDs from '@modules/cluster/components/ClusterViewCRDs';
import ClusterViewCustom from '@modules/cluster/components/ClusterViewCustom';
import ClusterViewEvents from '@modules/cluster/components/ClusterViewEvents';
import ClusterViewNamespaces from '@modules/cluster/components/ClusterViewNamespaces';
import ClusterViewNodes from '@modules/cluster/components/ClusterViewNodes';
import ClusterViewRBAC from '@modules/cluster/components/ClusterViewRBAC';
import ClusterViewStorage from '@modules/cluster/components/ClusterViewStorage';
import type { ClusterViewType } from '@ui/navigation/types';
import React from 'react';

interface ClusterResourcesViewsProps {
  // Each resource view is query-backed (sourced from its own typed query + replay
  // cache), so it needs only the per-view error (for the empty-state text) and, for
  // kind-filtered views, the available kinds. Custom is catalog-backed and also takes
  // its loading/loaded.
  nodesError?: string | null;

  configError?: string | null;

  crdsError?: string | null;

  customLoading?: boolean;
  customError?: string | null;
  customLoaded?: boolean;

  eventsError?: string | null;

  rbacError?: string | null;

  storageError?: string | null;

  // Tab control from parent
  activeTab?: ClusterViewType | null;
  onTabChange?: (tab: ClusterViewType) => void;

  // Object panel element to render
}

function ClusterResourcesViews({
  nodesError = null,
  configError = null,
  crdsError = null,
  customLoading = false,
  customError = null,
  customLoaded = false,
  eventsError = null,
  rbacError = null,
  storageError = null,
  activeTab: controlledActiveTab,
  onTabChange: _onTabChangeCallback,
}: ClusterResourcesViewsProps) {
  const activeTab = controlledActiveTab ?? null;

  // Render content based on active tab
  const renderTabContent = () => {
    if (!activeTab) {
      return null;
    }

    switch (activeTab) {
      case 'attention':
        return <ClusterViewAttention />;
      case 'namespaces':
        return <ClusterViewNamespaces />;
      case 'nodes':
        return <ClusterViewNodes error={nodesError} />;
      case 'config':
        return <ClusterViewConfig error={configError} />;
      case 'crds':
        return <ClusterViewCRDs error={crdsError} />;
      case 'custom':
        return (
          <ClusterViewCustom loading={customLoading} loaded={customLoaded} error={customError} />
        );
      case 'events':
        return <ClusterViewEvents error={eventsError} />;
      case 'rbac':
        return <ClusterViewRBAC error={rbacError} />;
      case 'storage':
        return <ClusterViewStorage error={storageError} />;
      default:
        return null;
    }
  };

  return <div className="view-content">{renderTabContent()}</div>;
}

export default React.memo(ClusterResourcesViews);
