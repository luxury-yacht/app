/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptorRegistry.ts
 *
 * Single source of truth mapping a Kubernetes kind to its Overview descriptor. Production dispatch
 * (index.tsx) and the runtime drift-check both read from here. Every built-in kind is registered;
 * kinds without a descriptor (custom resources and anything unregistered) fall back to the generic
 * overviewRegistry/GenericOverview path.
 */

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
import { networkPolicyDescriptor } from './descriptors/networkpolicy';
import { nodeDescriptor } from './descriptors/node';
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
import type { OverviewDescriptor } from './schema';

interface Registration {
  kinds: string[];
  descriptor: OverviewDescriptor<never>;
}

const registration = <T>(kinds: string[], descriptor: OverviewDescriptor<T>): Registration => ({
  kinds,
  descriptor: descriptor as unknown as OverviewDescriptor<never>,
});

const registrations: Registration[] = [
  registration(['event'], eventDescriptor),
  registration(['configmap'], configMapDescriptor),
  registration(['service'], serviceDescriptor),
  registration(['secret'], secretDescriptor),
  registration(['networkpolicy'], networkPolicyDescriptor),
  registration(['ingress'], ingressDescriptor),
  registration(['helmrelease'], helmReleaseDescriptor),
  registration(['persistentvolumeclaim'], pvcDescriptor),
  registration(['persistentvolume'], pvDescriptor),
  registration(['storageclass'], storageClassDescriptor),
  registration(['customresourcedefinition'], crdDescriptor),
  registration(['ingressclass'], ingressClassDescriptor),
  registration(['namespace'], namespaceDescriptor),
  registration(['mutatingwebhookconfiguration'], mutatingWebhookDescriptor),
  registration(['validatingwebhookconfiguration'], validatingWebhookDescriptor),
  registration(['pod'], podDescriptor),
  registration(['endpointslice'], endpointSliceDescriptor),
  registration(['node'], nodeDescriptor),
  registration(['serviceaccount'], serviceAccountDescriptor),
  registration(['role'], roleDescriptor),
  registration(['rolebinding'], roleBindingDescriptor),
  registration(['clusterrole'], clusterRoleDescriptor),
  registration(['clusterrolebinding'], clusterRoleBindingDescriptor),
  registration(['horizontalpodautoscaler'], hpaDescriptor),
  registration(['limitrange'], limitRangeDescriptor),
  registration(['poddisruptionbudget'], pdbDescriptor),
  registration(['resourcequota'], resourceQuotaDescriptor),
  registration(['deployment'], deploymentDescriptor),
  registration(['daemonset'], daemonSetDescriptor),
  registration(['statefulset'], statefulSetDescriptor),
  registration(['replicaset'], replicaSetDescriptor),
  registration(['job'], jobDescriptor),
  registration(['cronjob'], cronJobDescriptor),
  registration(['gateway'], gatewayDescriptor),
  registration(['gatewayclass'], gatewayClassDescriptor),
  registration(['listenerset'], listenerSetDescriptor),
  registration(['httproute'], httpRouteDescriptor),
  registration(['grpcroute'], grpcRouteDescriptor),
  registration(['tlsroute'], tlsRouteDescriptor),
  registration(['referencegrant'], referenceGrantDescriptor),
  registration(['backendtlspolicy'], backendTLSPolicyDescriptor),
];

const byKind = new Map<string, OverviewDescriptor<never>>();
for (const reg of registrations) {
  for (const kind of reg.kinds) {
    byKind.set(kind.toLowerCase(), reg.descriptor);
  }
}

export function getOverviewDescriptor(
  kind: string | null | undefined
): OverviewDescriptor<never> | undefined {
  if (!kind) {
    return undefined;
  }
  return byKind.get(kind.toLowerCase());
}

/** Unique descriptors (one per registration) — for the drift-check to iterate. */
export const registeredDescriptors = registrations.map((reg) => reg.descriptor);
