/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptorRegistry.ts
 *
 * Single source of truth mapping an object-details payload's `detailType` to its Overview
 * descriptor. Production dispatch (index.tsx) and the drift-check both read from here. Every
 * built-in detail type must have a descriptor typed against its own DTO; custom resources resolve
 * by their family facts; anything else falls back to the generic GenericOverview path.
 */

import type {
  CustomResourceDetails,
  ObjectDetail,
  ObjectDetailType,
  ObjectDetailTypes,
} from '@/core/refresh/types';
import { argoCDDescriptor, getArgoCDOverviewDescriptor } from './descriptors/argocd';
import {
  crdDescriptor,
  ingressClassDescriptor,
  mutatingWebhookDescriptor,
  namespaceDescriptor,
  validatingWebhookDescriptor,
} from './descriptors/clusterresource';
import { configMapDescriptor } from './descriptors/configmap';
import { endpointSliceDescriptor } from './descriptors/endpointslice';
import { eventDescriptor } from './descriptors/event';
import {
  backendTLSPolicyDescriptor,
  gatewayClassDescriptor,
  gatewayDescriptor,
  grpcRouteDescriptor,
  httpRouteDescriptor,
  listenerSetDescriptor,
  referenceGrantDescriptor,
  tlsRouteDescriptor,
} from './descriptors/gateway';
import { helmReleaseDescriptor } from './descriptors/helm';
import { ingressDescriptor } from './descriptors/ingress';
import { cronJobDescriptor, jobDescriptor } from './descriptors/job';
import { getKarpenterOverviewDescriptor, karpenterDescriptor } from './descriptors/karpenter';
import { networkPolicyDescriptor } from './descriptors/networkpolicy';
import { nodeDescriptor } from './descriptors/node';
import { getOperatorOverviewDescriptor, operatorDescriptor } from './descriptors/operators';
import { podDescriptor } from './descriptors/pod';
import {
  hpaDescriptor,
  limitRangeDescriptor,
  pdbDescriptor,
  resourceQuotaDescriptor,
} from './descriptors/policy';
import {
  clusterRoleBindingDescriptor,
  clusterRoleDescriptor,
  roleBindingDescriptor,
  roleDescriptor,
  serviceAccountDescriptor,
} from './descriptors/rbac';
import { secretDescriptor } from './descriptors/secret';
import { serviceDescriptor } from './descriptors/service';
import { pvcDescriptor, pvDescriptor, storageClassDescriptor } from './descriptors/storage';
import {
  daemonSetDescriptor,
  deploymentDescriptor,
  replicaSetDescriptor,
  statefulSetDescriptor,
} from './descriptors/workload';
import type { DescriptorCoverageSource, OverviewDescriptor } from './schema';

type DescriptorFor<K extends ObjectDetailType> = OverviewDescriptor<ObjectDetailTypes[K]>;

/** Detail types fetched for built-in kinds: one per generated detail fetcher. */
type BuiltinDetailType = Exclude<ObjectDetailType, 'customresource' | 'generic'>;

// Required per built-in detail type, and each descriptor is checked against that type's DTO, so a
// new fetcher without a descriptor, or a descriptor for the wrong DTO, fails to compile.
const BUILTIN_DESCRIPTORS: { [K in BuiltinDetailType]: DescriptorFor<K> } = {
  event: eventDescriptor,
  configmap: configMapDescriptor,
  service: serviceDescriptor,
  secret: secretDescriptor,
  networkpolicy: networkPolicyDescriptor,
  ingress: ingressDescriptor,
  helmrelease: helmReleaseDescriptor,
  persistentvolumeclaim: pvcDescriptor,
  persistentvolume: pvDescriptor,
  storageclass: storageClassDescriptor,
  customresourcedefinition: crdDescriptor,
  ingressclass: ingressClassDescriptor,
  namespace: namespaceDescriptor,
  mutatingwebhookconfiguration: mutatingWebhookDescriptor,
  validatingwebhookconfiguration: validatingWebhookDescriptor,
  pod: podDescriptor,
  endpointslice: endpointSliceDescriptor,
  node: nodeDescriptor,
  serviceaccount: serviceAccountDescriptor,
  role: roleDescriptor,
  rolebinding: roleBindingDescriptor,
  clusterrole: clusterRoleDescriptor,
  clusterrolebinding: clusterRoleBindingDescriptor,
  horizontalpodautoscaler: hpaDescriptor,
  limitrange: limitRangeDescriptor,
  poddisruptionbudget: pdbDescriptor,
  resourcequota: resourceQuotaDescriptor,
  deployment: deploymentDescriptor,
  daemonset: daemonSetDescriptor,
  statefulset: statefulSetDescriptor,
  replicaset: replicaSetDescriptor,
  job: jobDescriptor,
  cronjob: cronJobDescriptor,
  gateway: gatewayDescriptor,
  gatewayclass: gatewayClassDescriptor,
  listenerset: listenerSetDescriptor,
  httproute: httpRouteDescriptor,
  grpcroute: grpcRouteDescriptor,
  tlsroute: tlsRouteDescriptor,
  referencegrant: referenceGrantDescriptor,
  backendtlspolicy: backendTLSPolicyDescriptor,
};

// Add-on families share the custom-resource DTO; the first family whose facts are present renders it.
const customResourceDescriptor = (
  details: CustomResourceDetails
): DescriptorFor<'customresource'> | undefined =>
  getArgoCDOverviewDescriptor(details) ??
  getKarpenterOverviewDescriptor(details) ??
  getOperatorOverviewDescriptor(details);

type OverviewEntry<T> = OverviewDescriptor<T> | ((details: T) => OverviewDescriptor<T> | undefined);

const OVERVIEW_ENTRIES: { [K in ObjectDetailType]?: OverviewEntry<ObjectDetailTypes[K]> } = {
  ...BUILTIN_DESCRIPTORS,
  customresource: customResourceDescriptor,
};

/** The Overview descriptor for a detail, typed against that detail's DTO; undefined → generic. */
export function resolveOverviewDescriptor<K extends ObjectDetailType>(
  detail: ObjectDetail<K>
): DescriptorFor<K> | undefined {
  const entry = OVERVIEW_ENTRIES[detail.detailType];
  return typeof entry === 'function' ? entry(detail.details) : entry;
}

/** Every registered descriptor (built-ins plus custom-resource families) — for the drift-check. */
export const registeredDescriptors: readonly DescriptorCoverageSource[] = [
  ...Object.values(BUILTIN_DESCRIPTORS),
  karpenterDescriptor,
  argoCDDescriptor,
  operatorDescriptor,
];
