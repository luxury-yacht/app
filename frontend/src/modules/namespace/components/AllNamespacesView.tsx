/**
 * frontend/src/modules/namespace/components/AllNamespacesView.tsx
 *
 * Module source for AllNamespacesView.
 * This component renders different views for the "All Namespaces" scope
 * based on the active tab selected by the user.
 */
import React from 'react';
import NsViewWorkloads from '@modules/namespace/components/NsViewWorkloads';
import NsViewPods from '@modules/namespace/components/NsViewPods';
import NsViewConfig from '@modules/namespace/components/NsViewConfig';
import NsViewAutoscaling from '@modules/namespace/components/NsViewAutoscaling';
import NsViewNetwork from '@modules/namespace/components/NsViewNetwork';
import NsViewQuotas from '@modules/namespace/components/NsViewQuotas';
import NsViewRBAC from '@modules/namespace/components/NsViewRBAC';
import NsViewStorage from '@modules/namespace/components/NsViewStorage';
import NsViewCustom from '@modules/namespace/components/NsViewCustom';
import NsViewHelm from '@modules/namespace/components/NsViewHelm';
import NsViewEvents from '@modules/namespace/components/NsViewEvents';
import BrowseView from '@modules/browse/components/BrowseView';
import type { NamespaceViewType } from '@/types/navigation/views';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import {
  useNamespaceResource,
  useNamespaceResources,
} from '@modules/namespace/contexts/NsResourcesContext';

const AllNamespacesConfigView: React.FC = () => {
  const configResource = useNamespaceResource('config');
  const errorMessage = configResource.error ? configResource.error.message : null;

  return (
    <>
      {errorMessage && (
        <div className="namespace-error-message">
          Failed to load configuration resources: {errorMessage}
        </div>
      )}
      <NsViewConfig namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    </>
  );
};

const AllNamespacesCustomView: React.FC = () => {
  return (
    <>
      <NsViewCustom
        namespace={ALL_NAMESPACES_SCOPE}
        loading={false}
        loaded={false}
        showNamespaceColumn
      />
    </>
  );
};

const AllNamespacesEventsView: React.FC = () => {
  const eventsResource = useNamespaceResource('events');
  const errorMessage = eventsResource.error ? eventsResource.error.message : null;

  return (
    <>
      {errorMessage && (
        <div className="namespace-error-message">Failed to load events: {errorMessage}</div>
      )}
      <NsViewEvents namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    </>
  );
};

const AllNamespacesAutoscalingView: React.FC = () => {
  const autoscalingResource = useNamespaceResource('autoscaling');
  const errorMessage = autoscalingResource.error ? autoscalingResource.error.message : null;

  return (
    <>
      {errorMessage && (
        <div className="namespace-error-message">
          Failed to load autoscaling resources: {errorMessage}
        </div>
      )}
      <NsViewAutoscaling namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    </>
  );
};

const AllNamespacesNetworkView: React.FC = () => {
  const networkResource = useNamespaceResource('network');
  const errorMessage = networkResource.error ? networkResource.error.message : null;

  return (
    <>
      {errorMessage && (
        <div className="namespace-error-message">
          Failed to load network resources: {errorMessage}
        </div>
      )}
      <NsViewNetwork namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    </>
  );
};

const AllNamespacesQuotasView: React.FC = () => {
  const quotasResource = useNamespaceResource('quotas');
  const errorMessage = quotasResource.error ? quotasResource.error.message : null;

  return (
    <>
      {errorMessage && (
        <div className="namespace-error-message">
          Failed to load quota resources: {errorMessage}
        </div>
      )}
      <NsViewQuotas namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    </>
  );
};

const AllNamespacesRBACView: React.FC = () => {
  const rbacResource = useNamespaceResource('rbac');
  const errorMessage = rbacResource.error ? rbacResource.error.message : null;

  return (
    <>
      {errorMessage && (
        <div className="namespace-error-message">Failed to load RBAC resources: {errorMessage}</div>
      )}
      <NsViewRBAC namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    </>
  );
};

const AllNamespacesStorageView: React.FC = () => {
  const storageResource = useNamespaceResource('storage');
  const errorMessage = storageResource.error ? storageResource.error.message : null;

  return (
    <>
      {errorMessage && (
        <div className="namespace-error-message">
          Failed to load storage resources: {errorMessage}
        </div>
      )}
      <NsViewStorage namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    </>
  );
};

const AllNamespacesHelmView: React.FC = () => {
  const helmResource = useNamespaceResource('helm');
  const errorMessage = helmResource.error ? helmResource.error.message : null;

  return (
    <>
      {errorMessage && (
        <div className="namespace-error-message">Failed to load Helm releases: {errorMessage}</div>
      )}
      <NsViewHelm namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    </>
  );
};

const AllNamespacesPodsView: React.FC = () => {
  const { pods: podsResource } = useNamespaceResources();

  return (
    <NsViewPods
      namespace={ALL_NAMESPACES_SCOPE}
      showNamespaceColumn
      metrics={podsResource.metrics}
    />
  );
};

const AllNamespacesWorkloadsView: React.FC = () => {
  const workloadsResource = useNamespaceResource('workloads');
  const errorMessage = workloadsResource.error ? workloadsResource.error.message : null;

  return (
    <>
      {errorMessage && (
        <div className="namespace-error-message">
          Failed to load workload resources: {errorMessage}
        </div>
      )}
      <NsViewWorkloads namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />
    </>
  );
};

interface AllNamespacesViewProps {
  activeTab: NamespaceViewType;
}

const AllNamespacesView: React.FC<AllNamespacesViewProps> = ({ activeTab }) => {
  const renderContent = () => {
    switch (activeTab) {
      case 'pods':
        return <AllNamespacesPodsView />;
      case 'workloads':
        return <AllNamespacesWorkloadsView />;
      case 'config':
        return <AllNamespacesConfigView />;
      case 'autoscaling':
        return <AllNamespacesAutoscalingView />;
      case 'network':
        return <AllNamespacesNetworkView />;
      case 'helm':
        return <AllNamespacesHelmView />;
      case 'events':
        return <AllNamespacesEventsView />;
      case 'quotas':
        return <AllNamespacesQuotasView />;
      case 'rbac':
        return <AllNamespacesRBACView />;
      case 'storage':
        return <AllNamespacesStorageView />;
      case 'custom':
        return <AllNamespacesCustomView />;
      case 'browse':
        return <BrowseView namespace={ALL_NAMESPACES_SCOPE} />;
      case 'map':
        return (
          <div className="namespace-placeholder">
            <p>Map is available for individual namespaces.</p>
          </div>
        );
      default:
        return (
          <div className="namespace-placeholder">
            <p>
              The <strong>{activeTab}</strong> view is not yet available for the "All" namespace.
            </p>
          </div>
        );
    }
  };

  return <div className="view-content">{renderContent()}</div>;
};

export default AllNamespacesView;
