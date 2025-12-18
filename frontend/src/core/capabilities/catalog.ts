import type { CapabilityDescriptor } from './types';

export type CapabilityScope = 'cluster' | 'namespace' | 'object';

export interface CapabilityDefinition {
  id: string;
  descriptor: CapabilityDescriptor;
  scope: CapabilityScope;
  feature?: string;
}

const clusterCapability = (
  id: string,
  resourceKind: string,
  verb: string,
  feature: string
): CapabilityDefinition => ({
  id,
  scope: 'cluster',
  feature,
  descriptor: {
    id,
    resourceKind,
    verb,
  },
});

export const CLUSTER_CAPABILITIES: CapabilityDefinition[] = [
  clusterCapability('cluster:namespaces:list', 'Namespace', 'list', 'Cluster overview'),
  clusterCapability('cluster:namespaces:update', 'Namespace', 'update', 'Cluster overview'),
  clusterCapability('cluster:namespaces:create', 'Namespace', 'create', 'Cluster overview'),
  clusterCapability('cluster:namespaces:delete', 'Namespace', 'delete', 'Cluster overview'),
  clusterCapability('cluster:nodes:list', 'Node', 'list', 'Nodes table'),
  clusterCapability('cluster:nodes:get', 'Node', 'get', 'Nodes table'),
  clusterCapability('cluster:nodes:update', 'Node', 'update', 'Node actions'),
  clusterCapability('cluster:nodes:patch', 'Node', 'patch', 'Node actions (cordon/drain)'),
  clusterCapability('cluster:nodes:delete', 'Node', 'delete', 'Node actions'),
  clusterCapability('cluster:persistentvolumes:list', 'PersistentVolume', 'list', 'Storage view'),
  clusterCapability(
    'cluster:persistentvolumes:update',
    'PersistentVolume',
    'update',
    'Storage view'
  ),
  clusterCapability(
    'cluster:persistentvolumes:delete',
    'PersistentVolume',
    'delete',
    'Storage actions'
  ),
  clusterCapability('cluster:storageclasses:list', 'StorageClass', 'list', 'Cluster config'),
  clusterCapability('cluster:storageclasses:update', 'StorageClass', 'update', 'Cluster config'),
  clusterCapability('cluster:storageclasses:delete', 'StorageClass', 'delete', 'Cluster config'),
  clusterCapability('cluster:ingressclasses:list', 'IngressClass', 'list', 'Cluster config'),
  clusterCapability('cluster:ingressclasses:update', 'IngressClass', 'update', 'Cluster config'),
  clusterCapability('cluster:ingressclasses:delete', 'IngressClass', 'delete', 'Cluster config'),
  clusterCapability(
    'cluster:mutatingwebhookconfigurations:list',
    'MutatingWebhookConfiguration',
    'list',
    'Cluster config'
  ),
  clusterCapability(
    'cluster:mutatingwebhookconfigurations:update',
    'MutatingWebhookConfiguration',
    'update',
    'Cluster config'
  ),
  clusterCapability(
    'cluster:mutatingwebhookconfigurations:delete',
    'MutatingWebhookConfiguration',
    'delete',
    'Cluster config'
  ),
  clusterCapability(
    'cluster:validatingwebhookconfigurations:list',
    'ValidatingWebhookConfiguration',
    'list',
    'Cluster config'
  ),
  clusterCapability(
    'cluster:validatingwebhookconfigurations:update',
    'ValidatingWebhookConfiguration',
    'update',
    'Cluster config'
  ),
  clusterCapability(
    'cluster:validatingwebhookconfigurations:delete',
    'ValidatingWebhookConfiguration',
    'delete',
    'Cluster config'
  ),
  clusterCapability('cluster:clusterroles:list', 'ClusterRole', 'list', 'Cluster RBAC'),
  clusterCapability('cluster:clusterroles:update', 'ClusterRole', 'update', 'Cluster RBAC'),
  clusterCapability('cluster:clusterroles:delete', 'ClusterRole', 'delete', 'Cluster RBAC'),
  clusterCapability(
    'cluster:clusterrolebindings:list',
    'ClusterRoleBinding',
    'list',
    'Cluster RBAC'
  ),
  clusterCapability(
    'cluster:clusterrolebindings:update',
    'ClusterRoleBinding',
    'update',
    'Cluster RBAC'
  ),
  clusterCapability(
    'cluster:clusterrolebindings:delete',
    'ClusterRoleBinding',
    'delete',
    'Cluster RBAC'
  ),
  clusterCapability('cluster:crds:list', 'CustomResourceDefinition', 'list', 'Cluster CRDs'),
  clusterCapability('cluster:crds:update', 'CustomResourceDefinition', 'update', 'Cluster CRDs'),
  clusterCapability('cluster:crds:delete', 'CustomResourceDefinition', 'delete', 'Cluster CRDs'),
  clusterCapability('cluster:events:list', 'Event', 'list', 'Cluster events'),
];
