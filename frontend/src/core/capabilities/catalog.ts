/**
 * frontend/src/core/capabilities/catalog.ts
 *
 * Namespace and cluster capability catalog definitions.
 * Provides predefined capability definitions for cluster-scoped
 * capabilities used throughout the application.
 */

import type { CapabilityDescriptor } from './types';
import { PERMISSION_FEATURES, type PermissionFeatureKey } from './permissionFeatures';

export type CapabilityScope = 'cluster' | 'namespace' | 'object';

export interface CapabilityDefinition {
  id: string;
  descriptor: CapabilityDescriptor;
  scope: CapabilityScope;
  feature?: PermissionFeatureKey;
}

const clusterCapability = (
  id: string,
  resourceKind: string,
  verb: string,
  feature: PermissionFeatureKey,
  subresource?: string
): CapabilityDefinition => ({
  id,
  scope: 'cluster',
  feature,
  descriptor: {
    id,
    resourceKind,
    verb,
    subresource,
  },
});

export const CLUSTER_CAPABILITIES: CapabilityDefinition[] = [
  clusterCapability(
    'cluster:namespaces:list',
    'Namespace',
    'list',
    PERMISSION_FEATURES.clusterOverview
  ),
  clusterCapability(
    'cluster:namespaces:update',
    'Namespace',
    'update',
    PERMISSION_FEATURES.clusterOverview
  ),
  clusterCapability(
    'cluster:namespaces:create',
    'Namespace',
    'create',
    PERMISSION_FEATURES.clusterOverview
  ),
  clusterCapability(
    'cluster:namespaces:delete',
    'Namespace',
    'delete',
    PERMISSION_FEATURES.clusterOverview
  ),
  clusterCapability('cluster:nodes:list', 'Node', 'list', PERMISSION_FEATURES.clusterNodes),
  clusterCapability('cluster:nodes:get', 'Node', 'get', PERMISSION_FEATURES.clusterNodes),
  clusterCapability('cluster:nodes:update', 'Node', 'update', PERMISSION_FEATURES.nodeActions),
  clusterCapability('cluster:nodes:action-get', 'Node', 'get', PERMISSION_FEATURES.nodeActions),
  clusterCapability('cluster:nodes:patch', 'Node', 'patch', PERMISSION_FEATURES.nodeActions),
  clusterCapability('cluster:nodes:delete', 'Node', 'delete', PERMISSION_FEATURES.nodeActions),
  clusterCapability(
    'cluster:pods:eviction:create',
    'Pod',
    'create',
    PERMISSION_FEATURES.nodeActions,
    'eviction'
  ),
  clusterCapability('cluster:pods:delete', 'Pod', 'delete', PERMISSION_FEATURES.nodeActions),
  clusterCapability(
    'cluster:persistentvolumes:list',
    'PersistentVolume',
    'list',
    PERMISSION_FEATURES.storageView
  ),
  clusterCapability(
    'cluster:persistentvolumes:update',
    'PersistentVolume',
    'update',
    PERMISSION_FEATURES.storageView
  ),
  clusterCapability(
    'cluster:persistentvolumes:delete',
    'PersistentVolume',
    'delete',
    PERMISSION_FEATURES.storageActions
  ),
  clusterCapability(
    'cluster:storageclasses:list',
    'StorageClass',
    'list',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:storageclasses:update',
    'StorageClass',
    'update',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:storageclasses:delete',
    'StorageClass',
    'delete',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:ingressclasses:list',
    'IngressClass',
    'list',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:ingressclasses:update',
    'IngressClass',
    'update',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:ingressclasses:delete',
    'IngressClass',
    'delete',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:gatewayclasses:list',
    'GatewayClass',
    'list',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:gatewayclasses:update',
    'GatewayClass',
    'update',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:gatewayclasses:delete',
    'GatewayClass',
    'delete',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:mutatingwebhookconfigurations:list',
    'MutatingWebhookConfiguration',
    'list',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:mutatingwebhookconfigurations:update',
    'MutatingWebhookConfiguration',
    'update',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:mutatingwebhookconfigurations:delete',
    'MutatingWebhookConfiguration',
    'delete',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:validatingwebhookconfigurations:list',
    'ValidatingWebhookConfiguration',
    'list',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:validatingwebhookconfigurations:update',
    'ValidatingWebhookConfiguration',
    'update',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:validatingwebhookconfigurations:delete',
    'ValidatingWebhookConfiguration',
    'delete',
    PERMISSION_FEATURES.clusterConfig
  ),
  clusterCapability(
    'cluster:clusterroles:list',
    'ClusterRole',
    'list',
    PERMISSION_FEATURES.clusterRBAC
  ),
  clusterCapability(
    'cluster:clusterroles:update',
    'ClusterRole',
    'update',
    PERMISSION_FEATURES.clusterRBAC
  ),
  clusterCapability(
    'cluster:clusterroles:delete',
    'ClusterRole',
    'delete',
    PERMISSION_FEATURES.clusterRBAC
  ),
  clusterCapability(
    'cluster:clusterrolebindings:list',
    'ClusterRoleBinding',
    'list',
    PERMISSION_FEATURES.clusterRBAC
  ),
  clusterCapability(
    'cluster:clusterrolebindings:update',
    'ClusterRoleBinding',
    'update',
    PERMISSION_FEATURES.clusterRBAC
  ),
  clusterCapability(
    'cluster:clusterrolebindings:delete',
    'ClusterRoleBinding',
    'delete',
    PERMISSION_FEATURES.clusterRBAC
  ),
  clusterCapability(
    'cluster:crds:list',
    'CustomResourceDefinition',
    'list',
    PERMISSION_FEATURES.clusterCRDs
  ),
  clusterCapability(
    'cluster:crds:update',
    'CustomResourceDefinition',
    'update',
    PERMISSION_FEATURES.clusterCRDs
  ),
  clusterCapability(
    'cluster:crds:delete',
    'CustomResourceDefinition',
    'delete',
    PERMISSION_FEATURES.clusterCRDs
  ),
  clusterCapability('cluster:events:list', 'Event', 'list', PERMISSION_FEATURES.clusterEvents),
];
