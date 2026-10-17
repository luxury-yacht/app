/**
 * frontend/src/modules/object-map/ObjectMap.stories.tsx
 *
 * Storybook stories for the ObjectMap component, including large fixtures
 * used for manual G6 renderer performance checks.
 */

import type {
  ObjectMapEdge,
  ObjectMapNode,
  ObjectMapReference,
  ObjectMapSnapshotPayload,
  ObjectMapStatus,
} from '@core/refresh/types';
import type { Meta, StoryObj } from '@storybook/react';
import { SidebarProvidersDecorator } from '../../../.storybook/decorators/SidebarProvidersDecorator';
import ObjectMap from './ObjectMap';
import { createObjectMapPerformanceFixture } from './objectMapPerformanceFixtures';

const fiveHundredNodeFixture = createObjectMapPerformanceFixture({
  nodeCount: 500,
  edgeCount: 1000,
});

const thousandNodeFixture = createObjectMapPerformanceFixture({
  nodeCount: 1000,
  edgeCount: 2000,
});

// A Helm release map as backend/refresh/snapshot/object_map_helm.go builds it:
// only the objects the release manifest names, no release card, and a missing
// node for each object the cluster confirms it does not have. Missing nodes
// never have edges because the backend links only objects it found.
const HELM_CLUSTER_ID = 'story-cluster';
const HELM_NAMESPACE = 'shop';
const HELM_CREATED_AT = '2026-09-01T12:00:00Z';
const RUNNING: ObjectMapStatus = { state: 'Running', label: 'Running', presentation: 'ready' };

const helmRef = (kind: string, name: string, group = '', version = 'v1'): ObjectMapReference => ({
  clusterId: HELM_CLUSTER_ID,
  clusterName: 'Story Cluster',
  group,
  version,
  kind,
  namespace: HELM_NAMESPACE,
  name,
});

const liveNode = (ref: ObjectMapReference, status?: ObjectMapStatus): ObjectMapNode => {
  const uid = `${ref.kind.toLowerCase()}-${ref.name}`;
  return {
    id: `${HELM_CLUSTER_ID}|uid:${uid}`,
    depth: 0,
    ref: { ...ref, uid },
    creationTimestamp: HELM_CREATED_AT,
    status,
  };
};

// A missing object has no UID, so its id is the backend's identity key.
const missingNode = (ref: ObjectMapReference): ObjectMapNode => ({
  id: `${HELM_CLUSTER_ID}|${[ref.namespace, ref.group, ref.version, ref.kind, ref.name].join('\u0000')}`,
  depth: 0,
  ref,
  missing: true,
});

const helmEdge = (
  source: ObjectMapNode,
  type: string,
  target: ObjectMapNode,
  label: string,
  tracedBy?: string
): ObjectMapEdge => ({
  id: [source.id, type, target.id, tracedBy ?? ''].join('|'),
  source: source.id,
  target: target.id,
  type,
  label,
  tracedBy,
});

const ingress = liveNode(helmRef('Ingress', 'checkout', 'networking.k8s.io'));
const service = liveNode(helmRef('Service', 'checkout'));
const deployment = liveNode(helmRef('Deployment', 'checkout', 'apps'), RUNNING);
const autoscaler = liveNode(helmRef('HorizontalPodAutoscaler', 'checkout', 'autoscaling', 'v2'));
const config = liveNode(helmRef('ConfigMap', 'checkout-config'));
const tls = liveNode(helmRef('Secret', 'checkout-tls'));
const serviceAccount = liveNode(helmRef('ServiceAccount', 'checkout'));
const role = liveNode(helmRef('Role', 'checkout-reader', 'rbac.authorization.k8s.io'));
const roleBinding = liveNode(
  helmRef('RoleBinding', 'checkout-reader', 'rbac.authorization.k8s.io')
);

const helmReleaseWithMissingObjects: ObjectMapSnapshotPayload = {
  clusterId: HELM_CLUSTER_ID,
  clusterName: 'Story Cluster',
  seed: helmRef('HelmRelease', 'checkout', 'helm.sh', 'v3'),
  nodes: [
    ingress,
    service,
    deployment,
    autoscaler,
    config,
    tls,
    serviceAccount,
    role,
    roleBinding,
    missingNode(helmRef('ConfigMap', 'checkout-feature-flags')),
    missingNode(helmRef('PodDisruptionBudget', 'checkout', 'policy')),
    missingNode(helmRef('ServiceMonitor', 'checkout', 'monitoring.coreos.com')),
  ],
  edges: [
    helmEdge(ingress, 'routes', service, 'routes to'),
    helmEdge(autoscaler, 'scales', deployment, 'scales', 'spec.scaleTargetRef'),
    helmEdge(deployment, 'uses', config, 'uses'),
    helmEdge(deployment, 'mounts', tls, 'mounts', 'volumes'),
    helmEdge(deployment, 'uses', serviceAccount, 'uses'),
    helmEdge(roleBinding, 'grants', role, 'grants', 'roleRef'),
    helmEdge(roleBinding, 'binds', serviceAccount, 'binds', 'subjects'),
  ],
  maxNodes: 250,
  truncated: false,
};

const ObjectMapStoryShell = ({ children }: { children: React.ReactNode }) => (
  <div className="object-map-story-shell">{children}</div>
);

const meta: Meta<typeof ObjectMap> = {
  title: 'Views/ObjectMap',
  component: ObjectMap,
  parameters: {
    layout: 'fullscreen',
  },
  // Node actions read the object-panel, dockable-panel, kubeconfig, and
  // namespace providers, so the map needs the app's full provider tree.
  decorators: [SidebarProvidersDecorator],
};

export default meta;
type Story = StoryObj<typeof ObjectMap>;

/** 500 nodes and 1,000 edges. */
export const FiveHundredNodes: Story = {
  render: () => (
    <ObjectMapStoryShell>
      <ObjectMap payload={fiveHundredNodeFixture} />
    </ObjectMapStoryShell>
  ),
};

/** 1,000 nodes and 2,000 edges. */
export const ThousandNodes: Story = {
  render: () => (
    <ObjectMapStoryShell>
      <ObjectMap payload={thousandNodeFixture} />
    </ObjectMapStoryShell>
  ),
};

/** Helm release whose manifest names three objects the cluster no longer has. */
export const HelmReleaseWithMissingObjects: Story = {
  render: () => (
    <ObjectMapStoryShell>
      <ObjectMap payload={helmReleaseWithMissingObjects} />
    </ObjectMapStoryShell>
  ),
};
