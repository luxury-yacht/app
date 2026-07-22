/**
 * frontend/src/modules/namespace/components/NsResourcesViews.tsx
 *
 * Module source for NsResourcesViews.
 * Component that manages namespace resource views
 * - Renders tabs and their corresponding content components
 * - Uses ErrorBoundary to handle errors in each view
 * - Implements a fallback UI for view rendering errors
 * - Each view is declared once in NS_VIEWS; adding a tab is one entry there.
 */

import BrowseView from '@modules/browse/components/BrowseView';
import NsViewAutoscaling from '@modules/namespace/components/NsViewAutoscaling';
import NsViewConfig from '@modules/namespace/components/NsViewConfig';
import NsViewCustom from '@modules/namespace/components/NsViewCustom';
import NsViewEvents from '@modules/namespace/components/NsViewEvents';
import NsViewHelm from '@modules/namespace/components/NsViewHelm';
import NsViewMap from '@modules/namespace/components/NsViewMap';
import NsViewNetwork from '@modules/namespace/components/NsViewNetwork';
import NsViewQuotas from '@modules/namespace/components/NsViewQuotas';
import NsViewRBAC from '@modules/namespace/components/NsViewRBAC';
import NsViewStorage from '@modules/namespace/components/NsViewStorage';
import NsViewWorkloads from '@modules/namespace/components/NsViewWorkloads';
import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';
import React from 'react';
import type { NamespaceViewType } from '@/types/navigation/views';

const ViewErrorFallback = ({ viewName, reset }: { viewName: string; reset: () => void }) => (
  <div className="namespace-view-error">
    <h4>Failed to load {viewName}</h4>
    <p>An error occurred while rendering this view.</p>
    <button type="button" className="button generic" onClick={reset}>
      Retry
    </button>
  </div>
);

// One entry per namespace tab: the error-boundary display name and the view
// component (every view takes the namespace as its only prop).
const NS_VIEWS: Partial<
  Record<NamespaceViewType, { name: string; Component: React.ComponentType<{ namespace: string }> }>
> = {
  browse: { name: 'Browse', Component: BrowseView },
  map: { name: 'Map', Component: NsViewMap },
  workloads: { name: 'Workloads', Component: NsViewWorkloads },
  config: { name: 'Config', Component: NsViewConfig },
  network: { name: 'Network', Component: NsViewNetwork },
  rbac: { name: 'RBAC', Component: NsViewRBAC },
  storage: { name: 'Storage', Component: NsViewStorage },
  autoscaling: { name: 'Autoscaling', Component: NsViewAutoscaling },
  quotas: { name: 'Quotas', Component: NsViewQuotas },
  custom: { name: 'Custom Resources', Component: NsViewCustom },
  helm: { name: 'Helm', Component: NsViewHelm },
  events: { name: 'Events', Component: NsViewEvents },
};

interface NamespaceResourcesViewsProps {
  namespace: string;
  activeTab: NamespaceViewType;
  onTabChange?: (tab: NamespaceViewType) => void;

  // Object panel element to render
}

/**
 * Component that manages namespace resource views
 * Renders tabs and their corresponding content components
 */
const NamespaceResourcesViews: React.FC<NamespaceResourcesViewsProps> = ({
  namespace,
  activeTab,
  onTabChange: _onTabChange,
}) => {
  const view = NS_VIEWS[activeTab];

  return (
    <div className="view-content">
      {view ? (
        <ErrorBoundary
          scope={`namespace-${activeTab}`}
          resetKeys={[namespace]}
          fallback={(_, reset) => <ViewErrorFallback viewName={view.name} reset={reset} />}
        >
          <view.Component namespace={namespace} />
        </ErrorBoundary>
      ) : null}
    </div>
  );
};

export default React.memo(NamespaceResourcesViews);
