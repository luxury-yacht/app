/**
 * frontend/src/modules/namespace/components/NsResourcesViews.tsx
 *
 * Module source for NsResourcesViews.
 * Component that manages namespace resource views
 * - Renders tabs and their corresponding content components
 * - Uses ErrorBoundary to handle errors in each view
 * - Implements a fallback UI for view rendering errors
 * - Each view component is imported and rendered based on the active tab
 */
import React from 'react';
import { NamespaceViewType } from '@/types/navigation/views';
import type { PodMetricsInfo } from '@/core/refresh/types';
import NsViewAutoscaling from '@modules/namespace/components/NsViewAutoscaling';
import NsViewConfig from '@modules/namespace/components/NsViewConfig';
import NsViewCustom from '@modules/namespace/components/NsViewCustom';
import NsViewEvents from '@modules/namespace/components/NsViewEvents';
import NsViewHelm from '@modules/namespace/components/NsViewHelm';
import NsViewNetwork from '@modules/namespace/components/NsViewNetwork';
import BrowseView from '@modules/browse/components/BrowseView';
import NsViewMap from '@modules/namespace/components/NsViewMap';
import NsViewPods from '@modules/namespace/components/NsViewPods';
import NsViewQuotas from '@modules/namespace/components/NsViewQuotas';
import NsViewRBAC from '@modules/namespace/components/NsViewRBAC';
import NsViewStorage from '@modules/namespace/components/NsViewStorage';
import NsViewWorkloads from '@modules/namespace/components/NsViewWorkloads';
import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';

const ViewErrorFallback = ({ viewName, reset }: { viewName: string; reset: () => void }) => (
  <div className="namespace-view-error">
    <h4>Failed to load {viewName}</h4>
    <p>An error occurred while rendering this view.</p>
    <button className="button generic" onClick={reset}>
      Retry
    </button>
  </div>
);

interface NamespaceResourcesViewsProps {
  namespace: string;
  activeTab: NamespaceViewType;
  onTabChange?: (tab: NamespaceViewType) => void;

  // Pods metrics (pod rows are query-backed; the live pod row set is not threaded in)
  nsPodsMetrics?: PodMetricsInfo | null;

  // Workloads kind filter options

  // Config kind filter options

  // Network kind filter options

  // RBAC kind filter options

  // Storage data

  // Autoscaling kind filter options

  // Quotas kind filter options

  // Helm data

  // Events data

  // Object panel element to render
  objectPanel?: React.ReactNode;
}

/**
 * Component that manages namespace resource views
 * Renders tabs and their corresponding content components
 */
const NamespaceResourcesViews: React.FC<NamespaceResourcesViewsProps> = ({
  namespace,
  activeTab,
  onTabChange: _onTabChange,

  nsPodsMetrics = null,

  objectPanel,
}) => {
  const renderTabContent = () => {
    switch (activeTab) {
      case 'browse':
        return (
          <ErrorBoundary
            scope="namespace-browse"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Browse" reset={reset} />}
          >
            <BrowseView namespace={namespace} />
          </ErrorBoundary>
        );
      case 'map':
        return (
          <ErrorBoundary
            scope="namespace-map"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Map" reset={reset} />}
          >
            <NsViewMap namespace={namespace} />
          </ErrorBoundary>
        );
      case 'pods':
        return (
          <ErrorBoundary
            scope="namespace-pods"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Pods" reset={reset} />}
          >
            <NsViewPods namespace={namespace} metrics={nsPodsMetrics} />
          </ErrorBoundary>
        );
      case 'workloads':
        return (
          <ErrorBoundary
            scope="namespace-workloads"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Workloads" reset={reset} />}
          >
            <NsViewWorkloads namespace={namespace} metrics={nsPodsMetrics} />
          </ErrorBoundary>
        );
      case 'config':
        return (
          <ErrorBoundary
            scope="namespace-config"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Config" reset={reset} />}
          >
            <NsViewConfig namespace={namespace} />
          </ErrorBoundary>
        );
      case 'network':
        return (
          <ErrorBoundary
            scope="namespace-network"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Network" reset={reset} />}
          >
            <NsViewNetwork namespace={namespace} />
          </ErrorBoundary>
        );
      case 'rbac':
        return (
          <ErrorBoundary
            scope="namespace-rbac"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="RBAC" reset={reset} />}
          >
            <NsViewRBAC namespace={namespace} />
          </ErrorBoundary>
        );
      case 'storage':
        return (
          <ErrorBoundary
            scope="namespace-storage"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Storage" reset={reset} />}
          >
            <NsViewStorage namespace={namespace} />
          </ErrorBoundary>
        );
      case 'autoscaling':
        return (
          <ErrorBoundary
            scope="namespace-autoscaling"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Autoscaling" reset={reset} />}
          >
            <NsViewAutoscaling namespace={namespace} />
          </ErrorBoundary>
        );
      case 'quotas':
        return (
          <ErrorBoundary
            scope="namespace-quotas"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Quotas" reset={reset} />}
          >
            <NsViewQuotas namespace={namespace} />
          </ErrorBoundary>
        );
      case 'custom':
        return (
          <ErrorBoundary
            scope="namespace-custom"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Custom Resources" reset={reset} />}
          >
            <NsViewCustom namespace={namespace} />
          </ErrorBoundary>
        );
      case 'helm':
        return (
          <ErrorBoundary
            scope="namespace-helm"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Helm" reset={reset} />}
          >
            <NsViewHelm namespace={namespace} />
          </ErrorBoundary>
        );
      case 'events':
        return (
          <ErrorBoundary
            scope="namespace-events"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Events" reset={reset} />}
          >
            <NsViewEvents namespace={namespace} />
          </ErrorBoundary>
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
};

export default React.memo(NamespaceResourcesViews);
