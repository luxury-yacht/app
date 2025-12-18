import React from 'react';
import { NamespaceViewType } from '@/types/navigation/views';
import type { PodMetricsInfo } from '@/core/refresh/types';
import NsViewAutoscaling from '@modules/namespace/components/NsViewAutoscaling';
import NsViewConfig from '@modules/namespace/components/NsViewConfig';
import NsViewCustom from '@modules/namespace/components/NsViewCustom';
import NsViewEvents from '@modules/namespace/components/NsViewEvents';
import NsViewHelm from '@modules/namespace/components/NsViewHelm';
import NsViewNetwork from '@modules/namespace/components/NsViewNetwork';
import NsViewPods from '@modules/namespace/components/NsViewPods';
import NsViewQuotas from '@modules/namespace/components/NsViewQuotas';
import NsViewRBAC from '@modules/namespace/components/NsViewRBAC';
import NsViewStorage from '@modules/namespace/components/NsViewStorage';
import NsViewWorkloads from '@modules/namespace/components/NsViewWorkloads';
import { ErrorBoundary } from '@/components/errors/ErrorBoundary';

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

  // Pods data and loading states
  nsPods?: any[];
  nsPodsLoading?: boolean;
  nsPodsError?: string | null;
  loadPods?: () => Promise<void>;
  nsPodsLoaded?: boolean;
  nsPodsMetrics?: PodMetricsInfo | null;

  // Workloads data and loading states
  nsWorkloads?: any[];
  nsWorkloadsLoading?: boolean;
  nsWorkloadsError?: string | null;
  loadWorkloads?: () => Promise<void>;
  nsWorkloadsLoaded?: boolean;

  // Config data
  nsConfig?: any[];
  nsConfigLoading?: boolean;
  nsConfigError?: string | null;
  loadConfig?: () => Promise<void>;
  nsConfigLoaded?: boolean;

  // Network data
  nsNetwork?: any[];
  nsNetworkLoading?: boolean;
  nsNetworkError?: string | null;
  loadNetwork?: () => Promise<void>;
  nsNetworkLoaded?: boolean;

  // RBAC data
  nsRBAC?: any[];
  nsRBACLoading?: boolean;
  nsRBACError?: string | null;
  loadRBAC?: () => Promise<void>;
  nsRBACLoaded?: boolean;

  // Storage data
  nsStorage?: any[];
  nsStorageLoading?: boolean;
  nsStorageError?: string | null;
  loadStorage?: () => Promise<void>;
  nsStorageLoaded?: boolean;

  // Autoscaling data
  nsAutoscaling?: any[];
  nsAutoscalingLoading?: boolean;
  nsAutoscalingError?: string | null;
  loadAutoscaling?: () => Promise<void>;
  nsAutoscalingLoaded?: boolean;

  // Quotas data
  nsQuotas?: any[];
  nsQuotasLoading?: boolean;
  nsQuotasError?: string | null;
  loadQuotas?: () => Promise<void>;
  nsQuotasLoaded?: boolean;

  // Custom resources data
  nsCustom?: any[];
  nsCustomLoading?: boolean;
  nsCustomError?: string | null;
  loadCustom?: () => Promise<void>;
  nsCustomLoaded?: boolean;

  // Helm data
  nsHelm?: any[];
  nsHelmLoading?: boolean;
  nsHelmError?: string | null;
  loadHelm?: () => Promise<void>;
  nsHelmLoaded?: boolean;

  // Events data
  nsEvents?: any[];
  nsEventsLoading?: boolean;
  nsEventsError?: string | null;
  loadEvents?: () => Promise<void>;
  nsEventsLoaded?: boolean;

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

  nsPods = [],
  nsPodsLoading = false,
  nsPodsLoaded = false,
  nsPodsError = null,
  nsPodsMetrics = null,

  nsWorkloads = [],
  nsWorkloadsLoading = false,
  nsWorkloadsLoaded = false,

  nsConfig = [],
  nsConfigLoading = false,
  nsConfigLoaded = false,

  nsNetwork = [],
  nsNetworkLoading = false,
  nsNetworkLoaded = false,

  nsRBAC = [],
  nsRBACLoading = false,
  nsRBACLoaded = false,

  nsStorage = [],
  nsStorageLoading = false,
  nsStorageLoaded = false,

  nsAutoscaling = [],
  nsAutoscalingLoading = false,
  nsAutoscalingLoaded = false,

  nsQuotas = [],
  nsQuotasLoading = false,
  nsQuotasLoaded = false,

  nsCustom = [],
  nsCustomLoading = false,
  nsCustomLoaded = false,

  nsHelm = [],
  nsHelmLoading = false,
  nsHelmLoaded = false,

  nsEvents = [],
  nsEventsLoading = false,
  nsEventsLoaded = false,
  objectPanel,
}) => {
  const renderTabContent = () => {
    switch (activeTab) {
      case 'pods':
        return (
          <ErrorBoundary
            scope="namespace-pods"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Pods" reset={reset} />}
          >
            <NsViewPods
              namespace={namespace}
              data={nsPods}
              loading={nsPodsLoading}
              loaded={nsPodsLoaded}
              error={nsPodsError}
              metrics={nsPodsMetrics}
            />
          </ErrorBoundary>
        );
      case 'workloads':
        return (
          <ErrorBoundary
            scope="namespace-workloads"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Workloads" reset={reset} />}
          >
            <NsViewWorkloads
              namespace={namespace}
              data={nsWorkloads}
              loading={nsWorkloadsLoading}
              loaded={nsWorkloadsLoaded}
              metrics={nsPodsMetrics}
            />
          </ErrorBoundary>
        );
      case 'config':
        return (
          <ErrorBoundary
            scope="namespace-config"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Config" reset={reset} />}
          >
            <NsViewConfig
              namespace={namespace}
              data={nsConfig}
              loading={nsConfigLoading}
              loaded={nsConfigLoaded}
            />
          </ErrorBoundary>
        );
      case 'network':
        return (
          <ErrorBoundary
            scope="namespace-network"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Network" reset={reset} />}
          >
            <NsViewNetwork
              namespace={namespace}
              data={nsNetwork}
              loading={nsNetworkLoading}
              loaded={nsNetworkLoaded}
            />
          </ErrorBoundary>
        );
      case 'rbac':
        return (
          <ErrorBoundary
            scope="namespace-rbac"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="RBAC" reset={reset} />}
          >
            <NsViewRBAC
              namespace={namespace}
              data={nsRBAC}
              loading={nsRBACLoading}
              loaded={nsRBACLoaded}
            />
          </ErrorBoundary>
        );
      case 'storage':
        return (
          <ErrorBoundary
            scope="namespace-storage"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Storage" reset={reset} />}
          >
            <NsViewStorage
              namespace={namespace}
              data={nsStorage}
              loading={nsStorageLoading}
              loaded={nsStorageLoaded}
            />
          </ErrorBoundary>
        );
      case 'autoscaling':
        return (
          <ErrorBoundary
            scope="namespace-autoscaling"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Autoscaling" reset={reset} />}
          >
            <NsViewAutoscaling
              namespace={namespace}
              data={nsAutoscaling}
              loading={nsAutoscalingLoading}
              loaded={nsAutoscalingLoaded}
            />
          </ErrorBoundary>
        );
      case 'quotas':
        return (
          <ErrorBoundary
            scope="namespace-quotas"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Quotas" reset={reset} />}
          >
            <NsViewQuotas
              namespace={namespace}
              data={nsQuotas}
              loading={nsQuotasLoading}
              loaded={nsQuotasLoaded}
            />
          </ErrorBoundary>
        );
      case 'custom':
        return (
          <ErrorBoundary
            scope="namespace-custom"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Custom Resources" reset={reset} />}
          >
            <NsViewCustom
              namespace={namespace}
              data={nsCustom}
              loading={nsCustomLoading}
              loaded={nsCustomLoaded}
            />
          </ErrorBoundary>
        );
      case 'helm':
        return (
          <ErrorBoundary
            scope="namespace-helm"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Helm" reset={reset} />}
          >
            <NsViewHelm
              namespace={namespace}
              data={nsHelm}
              loading={nsHelmLoading}
              loaded={nsHelmLoaded}
            />
          </ErrorBoundary>
        );
      case 'events':
        return (
          <ErrorBoundary
            scope="namespace-events"
            resetKeys={[namespace]}
            fallback={(_, reset) => <ViewErrorFallback viewName="Events" reset={reset} />}
          >
            <NsViewEvents
              data={nsEvents}
              loading={nsEventsLoading}
              loaded={nsEventsLoaded}
              namespace={namespace}
            />
          </ErrorBoundary>
        );
      default:
        return null;
    }
  };

  return (
    <div className="view-container">
      <div className="view-content">
        {renderTabContent()}
        {objectPanel}
      </div>
    </div>
  );
};

export default React.memo(NamespaceResourcesViews);
