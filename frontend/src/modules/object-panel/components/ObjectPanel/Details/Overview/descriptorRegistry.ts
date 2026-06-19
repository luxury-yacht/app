/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptorRegistry.ts
 *
 * Single source of truth mapping a Kubernetes kind to its Overview descriptor. Production dispatch
 * (index.tsx) and the runtime drift-check both read from here. Every built-in kind is registered;
 * kinds without a descriptor (custom resources and anything unregistered) fall back to the generic
 * overviewRegistry/GenericOverview path.
 */

import type { OverviewDescriptor } from './schema';
import { configMapDescriptor } from './descriptors/configmap';
import { serviceDescriptor } from './descriptors/service';
import { secretDescriptor } from './descriptors/secret';
import { networkPolicyDescriptor } from './descriptors/networkpolicy';
import { ingressDescriptor } from './descriptors/ingress';
import { helmReleaseDescriptor } from './descriptors/helm';
import { pvcDescriptor, pvDescriptor, storageClassDescriptor } from './descriptors/storage';
import {
  crdDescriptor,
  ingressClassDescriptor,
  namespaceDescriptor,
  mutatingWebhookDescriptor,
  validatingWebhookDescriptor,
} from './descriptors/clusterresource';
import { podDescriptor } from './descriptors/pod';
import { endpointSliceDescriptor } from './descriptors/endpointslice';
import { nodeDescriptor } from './descriptors/node';
import {
  serviceAccountDescriptor,
  roleDescriptor,
  roleBindingDescriptor,
  clusterRoleDescriptor,
  clusterRoleBindingDescriptor,
} from './descriptors/rbac';
import {
  hpaDescriptor,
  limitRangeDescriptor,
  pdbDescriptor,
  resourceQuotaDescriptor,
} from './descriptors/policy';
import {
  deploymentDescriptor,
  daemonSetDescriptor,
  statefulSetDescriptor,
  replicaSetDescriptor,
} from './descriptors/workload';
import { jobDescriptor, cronJobDescriptor } from './descriptors/job';
import {
  gatewayDescriptor,
  gatewayClassDescriptor,
  listenerSetDescriptor,
  httpRouteDescriptor,
  grpcRouteDescriptor,
  tlsRouteDescriptor,
  referenceGrantDescriptor,
  backendTLSPolicyDescriptor,
} from './descriptors/gateway';

interface Registration {
  kinds: string[];

  descriptor: OverviewDescriptor<any>;
}

const registrations: Registration[] = [
  { kinds: ['configmap'], descriptor: configMapDescriptor },
  { kinds: ['service'], descriptor: serviceDescriptor },
  { kinds: ['secret'], descriptor: secretDescriptor },
  { kinds: ['networkpolicy'], descriptor: networkPolicyDescriptor },
  { kinds: ['ingress'], descriptor: ingressDescriptor },
  { kinds: ['helmrelease'], descriptor: helmReleaseDescriptor },
  { kinds: ['persistentvolumeclaim'], descriptor: pvcDescriptor },
  { kinds: ['persistentvolume'], descriptor: pvDescriptor },
  { kinds: ['storageclass'], descriptor: storageClassDescriptor },
  { kinds: ['customresourcedefinition'], descriptor: crdDescriptor },
  { kinds: ['ingressclass'], descriptor: ingressClassDescriptor },
  { kinds: ['namespace'], descriptor: namespaceDescriptor },
  { kinds: ['mutatingwebhookconfiguration'], descriptor: mutatingWebhookDescriptor },
  { kinds: ['validatingwebhookconfiguration'], descriptor: validatingWebhookDescriptor },
  { kinds: ['pod'], descriptor: podDescriptor },
  { kinds: ['endpointslice'], descriptor: endpointSliceDescriptor },
  { kinds: ['node'], descriptor: nodeDescriptor },
  { kinds: ['serviceaccount'], descriptor: serviceAccountDescriptor },
  { kinds: ['role'], descriptor: roleDescriptor },
  { kinds: ['rolebinding'], descriptor: roleBindingDescriptor },
  { kinds: ['clusterrole'], descriptor: clusterRoleDescriptor },
  { kinds: ['clusterrolebinding'], descriptor: clusterRoleBindingDescriptor },
  { kinds: ['horizontalpodautoscaler'], descriptor: hpaDescriptor },
  { kinds: ['limitrange'], descriptor: limitRangeDescriptor },
  { kinds: ['poddisruptionbudget'], descriptor: pdbDescriptor },
  { kinds: ['resourcequota'], descriptor: resourceQuotaDescriptor },
  { kinds: ['deployment'], descriptor: deploymentDescriptor },
  { kinds: ['daemonset'], descriptor: daemonSetDescriptor },
  { kinds: ['statefulset'], descriptor: statefulSetDescriptor },
  { kinds: ['replicaset'], descriptor: replicaSetDescriptor },
  { kinds: ['job'], descriptor: jobDescriptor },
  { kinds: ['cronjob'], descriptor: cronJobDescriptor },
  { kinds: ['gateway'], descriptor: gatewayDescriptor },
  { kinds: ['gatewayclass'], descriptor: gatewayClassDescriptor },
  { kinds: ['listenerset'], descriptor: listenerSetDescriptor },
  { kinds: ['httproute'], descriptor: httpRouteDescriptor },
  { kinds: ['grpcroute'], descriptor: grpcRouteDescriptor },
  { kinds: ['tlsroute'], descriptor: tlsRouteDescriptor },
  { kinds: ['referencegrant'], descriptor: referenceGrantDescriptor },
  { kinds: ['backendtlspolicy'], descriptor: backendTLSPolicyDescriptor },
];

const byKind = new Map<string, OverviewDescriptor<any>>();
for (const reg of registrations) {
  for (const kind of reg.kinds) {
    byKind.set(kind.toLowerCase(), reg.descriptor);
  }
}

export function getOverviewDescriptor(
  kind: string | null | undefined
): OverviewDescriptor<any> | undefined {
  if (!kind) return undefined;
  return byKind.get(kind.toLowerCase());
}

/** Unique descriptors (one per registration) — for the drift-check to iterate. */
export const registeredDescriptors = registrations.map((reg) => reg.descriptor);
