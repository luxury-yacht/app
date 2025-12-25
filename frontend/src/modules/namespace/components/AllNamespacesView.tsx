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
import type { NamespaceViewType } from '@/types/navigation/views';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import {
  NamespaceResourcesProvider,
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
      <NsViewConfig
        namespace={ALL_NAMESPACES_SCOPE}
        data={configResource.data ?? []}
        loading={configResource.loading}
        loaded={configResource.hasLoaded}
        showNamespaceColumn
      />
    </>
  );
};

const AllNamespacesCustomView: React.FC = () => {
  const customResource = useNamespaceResource('custom');
  const errorMessage = customResource.error ? customResource.error.message : null;

  return (
    <>
      {errorMessage && (
        <div className="namespace-error-message">
          Failed to load custom resources: {errorMessage}
        </div>
      )}
      <NsViewCustom
        namespace={ALL_NAMESPACES_SCOPE}
        data={customResource.data ?? []}
        loading={customResource.loading}
        loaded={customResource.hasLoaded}
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
      <NsViewEvents
        namespace={ALL_NAMESPACES_SCOPE}
        data={eventsResource.data ?? []}
        loading={eventsResource.loading}
        loaded={eventsResource.hasLoaded}
        showNamespaceColumn
      />
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
      <NsViewAutoscaling
        namespace={ALL_NAMESPACES_SCOPE}
        data={autoscalingResource.data ?? []}
        loading={autoscalingResource.loading}
        loaded={autoscalingResource.hasLoaded}
        showNamespaceColumn
      />
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
      <NsViewNetwork
        namespace={ALL_NAMESPACES_SCOPE}
        data={networkResource.data ?? []}
        loading={networkResource.loading}
        loaded={networkResource.hasLoaded}
        showNamespaceColumn
      />
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
      <NsViewQuotas
        namespace={ALL_NAMESPACES_SCOPE}
        data={quotasResource.data ?? []}
        loading={quotasResource.loading}
        loaded={quotasResource.hasLoaded}
        showNamespaceColumn
      />
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
      <NsViewRBAC
        namespace={ALL_NAMESPACES_SCOPE}
        data={rbacResource.data ?? []}
        loading={rbacResource.loading}
        loaded={rbacResource.hasLoaded}
        showNamespaceColumn
      />
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
      <NsViewStorage
        namespace={ALL_NAMESPACES_SCOPE}
        data={storageResource.data ?? []}
        loading={storageResource.loading}
        loaded={storageResource.hasLoaded}
        showNamespaceColumn
      />
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
      <NsViewHelm
        namespace={ALL_NAMESPACES_SCOPE}
        data={helmResource.data ?? []}
        loading={helmResource.loading}
        loaded={helmResource.hasLoaded}
        showNamespaceColumn
      />
    </>
  );
};

const AllNamespacesPodsView: React.FC = () => {
  const { pods: podsResource } = useNamespaceResources();

  return (
    <NsViewPods
      namespace={ALL_NAMESPACES_SCOPE}
      data={podsResource.data ?? []}
      loading={podsResource.loading}
      loaded={podsResource.hasLoaded}
      showNamespaceColumn
      error={podsResource.error ? podsResource.error.message : null}
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
      <NsViewWorkloads
        namespace={ALL_NAMESPACES_SCOPE}
        data={workloadsResource.data ?? []}
        loading={workloadsResource.loading}
        loaded={workloadsResource.hasLoaded}
        showNamespaceColumn
      />
    </>
  );
};

interface AllNamespacesViewProps {
  activeTab: NamespaceViewType;
}

const AllNamespacesView: React.FC<AllNamespacesViewProps> = ({ activeTab }) => {
  if (activeTab === 'pods') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="pods">
        <div className="all-namespaces-view">
          <AllNamespacesPodsView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  if (activeTab === 'workloads') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="workloads">
        <div className="all-namespaces-view">
          <AllNamespacesWorkloadsView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  if (activeTab === 'config') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="config">
        <div className="all-namespaces-view">
          <AllNamespacesConfigView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  if (activeTab === 'autoscaling') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="autoscaling">
        <div className="all-namespaces-view">
          <AllNamespacesAutoscalingView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  if (activeTab === 'network') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="network">
        <div className="all-namespaces-view">
          <AllNamespacesNetworkView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  if (activeTab === 'helm') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="helm">
        <div className="all-namespaces-view">
          <AllNamespacesHelmView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  if (activeTab === 'events') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="events">
        <div className="all-namespaces-view">
          <AllNamespacesEventsView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  if (activeTab === 'quotas') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="quotas">
        <div className="all-namespaces-view">
          <AllNamespacesQuotasView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  if (activeTab === 'rbac') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="rbac">
        <div className="all-namespaces-view">
          <AllNamespacesRBACView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  if (activeTab === 'storage') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="storage">
        <div className="all-namespaces-view">
          <AllNamespacesStorageView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  if (activeTab === 'custom') {
    return (
      <NamespaceResourcesProvider namespace={ALL_NAMESPACES_SCOPE} activeView="custom">
        <div className="all-namespaces-view">
          <AllNamespacesCustomView />
        </div>
      </NamespaceResourcesProvider>
    );
  }

  return (
    <div className="namespace-placeholder">
      <p>
        The <strong>{activeTab}</strong> view is not yet available for the “All” namespace.
      </p>
    </div>
  );
};

export default AllNamespacesView;
