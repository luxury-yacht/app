/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/registry.ts
 *
 * UI component for registry.
 * Handles rendering and interactions for the object panel feature.
 */

import React from 'react';

// Import all overview components from local directory
import { ClusterResourceOverview } from './ClusterResourceOverview';
import { NodeOverview } from './NodeOverview';
import { ConfigMapOverview } from './ConfigMapOverview';
import { SecretOverview } from './SecretOverview';
import { EndpointSliceOverview } from './EndpointsOverview';
import { IngressOverview } from './IngressOverview';
import { NetworkPolicyOverview } from './NetworkPolicyOverview';
import { ServiceOverview } from './ServiceOverview';
import { StorageOverview } from './StorageOverview';
import { JobOverview } from './JobOverview';
import { PodOverview } from './PodOverview';
import { WorkloadOverview } from './WorkloadOverview';
import { HelmOverview } from './HelmOverview';
import { PolicyOverview } from './PolicyOverview';
import { RBACOverview } from './RBACOverview';
import { GenericOverview } from './GenericOverview';

/**
 * Configuration for an overview component
 */
interface OverviewComponentConfig {
  kinds: string[];
  component: React.ComponentType<any>;
  mapProps?: (props: any) => any;
  capabilities?: {
    delete?: boolean;
    restart?: boolean;
    scale?: boolean;
    edit?: boolean;
    logs?: boolean;
    exec?: boolean;
  };
}

/**
 * Registry for overview components
 */
class OverviewComponentRegistry {
  private components = new Map<string, OverviewComponentConfig>();

  /**
   * Register a component configuration
   */
  register(config: OverviewComponentConfig) {
    config.kinds.forEach((kind) => {
      this.components.set(kind.toLowerCase(), config);
    });
  }

  /**
   * Get component configuration for a kind
   */
  getComponent(kind: string): OverviewComponentConfig | undefined {
    return this.components.get(kind.toLowerCase());
  }

  /**
   * Render component for given props
   */
  renderComponent(props: any): React.ReactElement {
    const kind = props.kind?.toLowerCase();
    const config = this.getComponent(kind);

    if (!config) {
      return React.createElement(GenericOverview, props);
    }

    const Component = config.component;
    const mappedProps = config.mapProps ? config.mapProps(props) : props;

    return React.createElement(Component, mappedProps);
  }
}

// Create and configure the registry
export const overviewRegistry = new OverviewComponentRegistry();

// Register Cluster Resource components
overviewRegistry.register({
  kinds: [
    'customresourcedefinition',
    'ingressclass',
    'mutatingwebhookconfiguration',
    'namespace',
    'validatingwebhookconfiguration',
  ],
  component: ClusterResourceOverview,
  capabilities: {
    delete: true,
    edit: true,
  },
});

// Register Config Resource components
overviewRegistry.register({
  kinds: ['configmap'],
  component: ConfigMapOverview,
  mapProps: (props) => ({ configMapDetails: props.configMapDetails || props }),
  capabilities: {
    delete: true,
    edit: true,
  },
});

overviewRegistry.register({
  kinds: ['secret'],
  component: SecretOverview,
  mapProps: (props) => ({ secretDetails: props.secretDetails || props }),
  capabilities: {
    delete: true,
    edit: true,
  },
});

// Register Job components
overviewRegistry.register({
  kinds: ['cronjob', 'job'],
  component: JobOverview,
  capabilities: {
    delete: true,
  },
});

// Register Network Resource components
overviewRegistry.register({
  kinds: ['service'],
  component: ServiceOverview,
  mapProps: (props) => ({ serviceDetails: props.serviceDetails || props }),
  capabilities: {
    delete: true,
    edit: true,
  },
});

overviewRegistry.register({
  kinds: ['ingress'],
  component: IngressOverview,
  mapProps: (props) => ({ ingressDetails: props.ingressDetails || props }),
  capabilities: {
    delete: true,
    edit: true,
  },
});

overviewRegistry.register({
  kinds: ['endpointslice'],
  component: EndpointSliceOverview,
  mapProps: (props) => ({ endpointSliceDetails: props.endpointSliceDetails || props }),
  capabilities: {
    delete: true,
  },
});

overviewRegistry.register({
  kinds: ['networkpolicy'],
  component: NetworkPolicyOverview,
  mapProps: (props) => ({ networkPolicyDetails: props.networkPolicyDetails || props }),
  capabilities: {
    delete: true,
    edit: true,
  },
});

// Register Node component
overviewRegistry.register({
  kinds: ['node'],
  component: NodeOverview,
  capabilities: {
    edit: true,
  },
});

// Register Pod component
overviewRegistry.register({
  kinds: ['pod'],
  component: PodOverview,
  capabilities: {
    delete: true,
    logs: true,
    exec: true,
  },
});

// Register Policy components
overviewRegistry.register({
  kinds: ['horizontalpodautoscaler', 'limitrange', 'poddisruptionbudget', 'resourcequota'],
  component: PolicyOverview,
  capabilities: {
    delete: true,
    edit: true,
  },
});

// Register RBAC components
overviewRegistry.register({
  kinds: ['clusterrole', 'clusterrolebinding', 'role', 'rolebinding', 'serviceaccount'],
  component: RBACOverview,
  capabilities: {
    delete: true,
    edit: true,
  },
});

// Register Storage components
overviewRegistry.register({
  kinds: ['persistentvolume', 'persistentvolumeclaim', 'storageclass'],
  component: StorageOverview,
  capabilities: {
    delete: true,
    edit: true,
  },
});

// Register Workload components
overviewRegistry.register({
  kinds: ['daemonset', 'deployment', 'statefulset'],
  component: WorkloadOverview,
  capabilities: {
    delete: true,
    restart: true,
    scale: true,
    edit: true,
  },
});

overviewRegistry.register({
  kinds: ['replicaset'],
  component: WorkloadOverview,
  capabilities: {
    delete: true,
  },
});

// Register Helm component
overviewRegistry.register({
  kinds: ['helmrelease'],
  component: HelmOverview,
  capabilities: {
    delete: true,
  },
});

// Export utility function to get capabilities
export function getResourceCapabilities(kind: string) {
  const config = overviewRegistry.getComponent(kind);
  // If no config found (likely a custom resource), enable delete by default
  return config?.capabilities || { delete: true };
}
