import { types } from '@wailsjs/go/models';
import type { KubernetesObjectReference } from '@/types/view-state';

export interface DetailSlots {
  podDetails: types.PodDetailInfo | null;
  deploymentDetails: types.DeploymentDetails | null;
  replicaSetDetails: types.ReplicaSetDetails | null;
  daemonSetDetails: types.DaemonSetDetails | null;
  statefulSetDetails: types.StatefulSetDetails | null;
  jobDetails: types.JobDetails | null;
  cronJobDetails: types.CronJobDetails | null;
  configMapDetails: types.ConfigMapDetails | null;
  secretDetails: types.SecretDetails | null;
  helmReleaseDetails: types.HelmReleaseDetails | null;
  serviceDetails: types.ServiceDetails | null;
  ingressDetails: types.IngressDetails | null;
  networkPolicyDetails: types.NetworkPolicyDetails | null;
  endpointSliceDetails: types.EndpointSliceDetails | null;
  gatewayDetails?: types.GatewayDetails | null;
  httpRouteDetails?: types.RouteDetails | null;
  grpcRouteDetails?: types.RouteDetails | null;
  tlsRouteDetails?: types.RouteDetails | null;
  listenerSetDetails?: types.ListenerSetDetails | null;
  referenceGrantDetails?: types.ReferenceGrantDetails | null;
  backendTLSPolicyDetails?: types.BackendTLSPolicyDetails | null;
  pvcDetails: types.PersistentVolumeClaimDetails | null;
  pvDetails: types.PersistentVolumeDetails | null;
  storageClassDetails: types.StorageClassDetails | null;
  serviceAccountDetails: types.ServiceAccountDetails | null;
  roleDetails: types.RoleDetails | null;
  roleBindingDetails: types.RoleBindingDetails | null;
  clusterRoleDetails: types.ClusterRoleDetails | null;
  clusterRoleBindingDetails: types.ClusterRoleBindingDetails | null;
  hpaDetails: types.HorizontalPodAutoscalerDetails | null;
  pdbDetails: types.PodDisruptionBudgetDetails | null;
  resourceQuotaDetails: types.ResourceQuotaDetails | null;
  limitRangeDetails: types.LimitRangeDetails | null;
  nodeDetails: types.NodeDetails | null;
  namespaceDetails: types.NamespaceDetails | null;
  ingressClassDetails: types.IngressClassDetails | null;
  gatewayClassDetails?: types.GatewayClassDetails | null;
  crdDetails: types.CustomResourceDefinitionDetails | null;
  mutatingWebhookDetails: types.MutatingWebhookConfigurationDetails | null;
  validatingWebhookDetails: types.ValidatingWebhookConfigurationDetails | null;
}

type DetailContainer = {
  name: string;
  image: string;
  ready?: boolean;
  restartCount?: number;
  state?: string;
  stateReason?: string;
  stateMessage?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memRequest?: string;
  memLimit?: string;
};

type PolicyRule = {
  apiGroups?: string[];
  resources?: string[];
  resourceNames?: string[];
  verbs?: string[];
  nonResourceURLs?: string[];
};

export interface DetailDataSection {
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  isSecret: boolean;
}

export interface DetailContainerSection {
  containers?: DetailContainer[];
  initContainers?: DetailContainer[];
}

export interface ObjectDetailModel {
  objectData: KubernetesObjectReference | null;
  objectKind: string | null;
  slots: DetailSlots;
  activePodNames: string[] | null;
  availableContainers: string[];
  containerSection: DetailContainerSection | null;
  dataSection: DetailDataSection | null;
  portForwardAvailable: boolean | undefined;
  roleRules?: PolicyRule[];
  desiredScaleReplicas: number;
  cronJobSuspended: boolean;
}

const EMPTY_DETAIL_SLOTS: DetailSlots = {
  podDetails: null,
  deploymentDetails: null,
  replicaSetDetails: null,
  daemonSetDetails: null,
  statefulSetDetails: null,
  jobDetails: null,
  cronJobDetails: null,
  configMapDetails: null,
  secretDetails: null,
  helmReleaseDetails: null,
  serviceDetails: null,
  ingressDetails: null,
  networkPolicyDetails: null,
  endpointSliceDetails: null,
  gatewayDetails: null,
  httpRouteDetails: null,
  grpcRouteDetails: null,
  tlsRouteDetails: null,
  listenerSetDetails: null,
  referenceGrantDetails: null,
  backendTLSPolicyDetails: null,
  pvcDetails: null,
  pvDetails: null,
  storageClassDetails: null,
  serviceAccountDetails: null,
  roleDetails: null,
  roleBindingDetails: null,
  clusterRoleDetails: null,
  clusterRoleBindingDetails: null,
  hpaDetails: null,
  pdbDetails: null,
  resourceQuotaDetails: null,
  limitRangeDetails: null,
  nodeDetails: null,
  namespaceDetails: null,
  ingressClassDetails: null,
  gatewayClassDetails: null,
  crdDetails: null,
  mutatingWebhookDetails: null,
  validatingWebhookDetails: null,
};

const NON_TCP_PORT_SUFFIX = /\/(UDP|SCTP)$/i;

const hasForwardableContainerDetails = (
  containers?: Array<{ ports?: string[] | null }> | null
): boolean =>
  containers?.some((container) =>
    container.ports?.some((port) => !NON_TCP_PORT_SUFFIX.test(port))
  ) ?? false;

const extractPodNames = (pods?: Array<{ name?: string | null }> | null): string[] | null => {
  if (!pods || pods.length === 0) {
    return null;
  }
  const names = pods
    .map((pod) => (typeof pod.name === 'string' ? pod.name.trim() : ''))
    .filter((name) => name.length > 0);
  return names.length > 0 ? names : null;
};

export function buildObjectDetailModel(
  objectData: KubernetesObjectReference | null,
  objectKind: string | null,
  detailPayload: unknown
): ObjectDetailModel {
  const slots = buildDetailSlots(objectKind, detailPayload);
  return createObjectDetailModelFromSlots(objectData, objectKind, slots);
}

export function createObjectDetailModelFromSlots(
  objectData: KubernetesObjectReference | null | undefined,
  objectKind: string | null | undefined,
  slots: DetailSlots
): ObjectDetailModel {
  const kind = objectKind?.toLowerCase() ?? objectData?.kind?.toLowerCase() ?? null;
  return {
    objectData: objectData ?? null,
    objectKind: kind,
    slots,
    activePodNames: selectActivePodNames(slots),
    availableContainers:
      slots.podDetails?.containers
        ?.map((container) => container.name?.trim())
        .filter((name): name is string => Boolean(name)) ?? [],
    containerSection: selectContainerSection(kind, slots),
    dataSection: selectDataSection(kind, slots),
    portForwardAvailable: selectPortForwardAvailable(kind, slots),
    roleRules: slots.roleDetails?.rules ?? slots.clusterRoleDetails?.rules,
    desiredScaleReplicas: selectDesiredScaleReplicas(kind, slots),
    cronJobSuspended: slots.cronJobDetails?.suspend ?? false,
  };
}

function buildDetailSlots(objectKind: string | null, detailPayload: unknown): DetailSlots {
  if (!detailPayload || !objectKind) {
    return EMPTY_DETAIL_SLOTS;
  }

  switch (objectKind) {
    case 'pod':
      return { ...EMPTY_DETAIL_SLOTS, podDetails: detailPayload as types.PodDetailInfo };
    case 'deployment':
      return { ...EMPTY_DETAIL_SLOTS, deploymentDetails: detailPayload as types.DeploymentDetails };
    case 'replicaset':
      return { ...EMPTY_DETAIL_SLOTS, replicaSetDetails: detailPayload as types.ReplicaSetDetails };
    case 'daemonset':
      return { ...EMPTY_DETAIL_SLOTS, daemonSetDetails: detailPayload as types.DaemonSetDetails };
    case 'statefulset':
      return {
        ...EMPTY_DETAIL_SLOTS,
        statefulSetDetails: detailPayload as types.StatefulSetDetails,
      };
    case 'job':
      return { ...EMPTY_DETAIL_SLOTS, jobDetails: detailPayload as types.JobDetails };
    case 'cronjob':
      return { ...EMPTY_DETAIL_SLOTS, cronJobDetails: detailPayload as types.CronJobDetails };
    case 'configmap':
      return { ...EMPTY_DETAIL_SLOTS, configMapDetails: detailPayload as types.ConfigMapDetails };
    case 'secret':
      return { ...EMPTY_DETAIL_SLOTS, secretDetails: detailPayload as types.SecretDetails };
    case 'helmrelease':
      return {
        ...EMPTY_DETAIL_SLOTS,
        helmReleaseDetails: detailPayload as types.HelmReleaseDetails,
      };
    case 'service':
      return { ...EMPTY_DETAIL_SLOTS, serviceDetails: detailPayload as types.ServiceDetails };
    case 'ingress':
      return { ...EMPTY_DETAIL_SLOTS, ingressDetails: detailPayload as types.IngressDetails };
    case 'networkpolicy':
      return {
        ...EMPTY_DETAIL_SLOTS,
        networkPolicyDetails: detailPayload as types.NetworkPolicyDetails,
      };
    case 'endpointslice':
      return {
        ...EMPTY_DETAIL_SLOTS,
        endpointSliceDetails: detailPayload as types.EndpointSliceDetails,
      };
    case 'gateway':
      return { ...EMPTY_DETAIL_SLOTS, gatewayDetails: detailPayload as types.GatewayDetails };
    case 'httproute':
      return { ...EMPTY_DETAIL_SLOTS, httpRouteDetails: detailPayload as types.RouteDetails };
    case 'grpcroute':
      return { ...EMPTY_DETAIL_SLOTS, grpcRouteDetails: detailPayload as types.RouteDetails };
    case 'tlsroute':
      return { ...EMPTY_DETAIL_SLOTS, tlsRouteDetails: detailPayload as types.RouteDetails };
    case 'listenerset':
      return {
        ...EMPTY_DETAIL_SLOTS,
        listenerSetDetails: detailPayload as types.ListenerSetDetails,
      };
    case 'referencegrant':
      return {
        ...EMPTY_DETAIL_SLOTS,
        referenceGrantDetails: detailPayload as types.ReferenceGrantDetails,
      };
    case 'backendtlspolicy':
      return {
        ...EMPTY_DETAIL_SLOTS,
        backendTLSPolicyDetails: detailPayload as types.BackendTLSPolicyDetails,
      };
    case 'persistentvolumeclaim':
      return {
        ...EMPTY_DETAIL_SLOTS,
        pvcDetails: detailPayload as types.PersistentVolumeClaimDetails,
      };
    case 'persistentvolume':
      return { ...EMPTY_DETAIL_SLOTS, pvDetails: detailPayload as types.PersistentVolumeDetails };
    case 'storageclass':
      return {
        ...EMPTY_DETAIL_SLOTS,
        storageClassDetails: detailPayload as types.StorageClassDetails,
      };
    case 'serviceaccount':
      return {
        ...EMPTY_DETAIL_SLOTS,
        serviceAccountDetails: detailPayload as types.ServiceAccountDetails,
      };
    case 'role':
      return { ...EMPTY_DETAIL_SLOTS, roleDetails: detailPayload as types.RoleDetails };
    case 'rolebinding':
      return {
        ...EMPTY_DETAIL_SLOTS,
        roleBindingDetails: detailPayload as types.RoleBindingDetails,
      };
    case 'clusterrole':
      return {
        ...EMPTY_DETAIL_SLOTS,
        clusterRoleDetails: detailPayload as types.ClusterRoleDetails,
      };
    case 'clusterrolebinding':
      return {
        ...EMPTY_DETAIL_SLOTS,
        clusterRoleBindingDetails: detailPayload as types.ClusterRoleBindingDetails,
      };
    case 'horizontalpodautoscaler':
      return {
        ...EMPTY_DETAIL_SLOTS,
        hpaDetails: detailPayload as types.HorizontalPodAutoscalerDetails,
      };
    case 'poddisruptionbudget':
      return {
        ...EMPTY_DETAIL_SLOTS,
        pdbDetails: detailPayload as types.PodDisruptionBudgetDetails,
      };
    case 'resourcequota':
      return {
        ...EMPTY_DETAIL_SLOTS,
        resourceQuotaDetails: detailPayload as types.ResourceQuotaDetails,
      };
    case 'limitrange':
      return { ...EMPTY_DETAIL_SLOTS, limitRangeDetails: detailPayload as types.LimitRangeDetails };
    case 'node':
      return { ...EMPTY_DETAIL_SLOTS, nodeDetails: detailPayload as types.NodeDetails };
    case 'namespace':
      return { ...EMPTY_DETAIL_SLOTS, namespaceDetails: detailPayload as types.NamespaceDetails };
    case 'ingressclass':
      return {
        ...EMPTY_DETAIL_SLOTS,
        ingressClassDetails: detailPayload as types.IngressClassDetails,
      };
    case 'gatewayclass':
      return {
        ...EMPTY_DETAIL_SLOTS,
        gatewayClassDetails: detailPayload as types.GatewayClassDetails,
      };
    case 'customresourcedefinition':
      return {
        ...EMPTY_DETAIL_SLOTS,
        crdDetails: detailPayload as types.CustomResourceDefinitionDetails,
      };
    case 'mutatingwebhookconfiguration':
      return {
        ...EMPTY_DETAIL_SLOTS,
        mutatingWebhookDetails: detailPayload as types.MutatingWebhookConfigurationDetails,
      };
    case 'validatingwebhookconfiguration':
      return {
        ...EMPTY_DETAIL_SLOTS,
        validatingWebhookDetails: detailPayload as types.ValidatingWebhookConfigurationDetails,
      };
    default:
      return EMPTY_DETAIL_SLOTS;
  }
}

function selectActivePodNames(slots: DetailSlots): string[] | null {
  return (
    extractPodNames(slots.deploymentDetails?.pods) ??
    extractPodNames(slots.daemonSetDetails?.pods) ??
    extractPodNames(slots.statefulSetDetails?.pods) ??
    extractPodNames(slots.jobDetails?.pods) ??
    extractPodNames(slots.cronJobDetails?.pods) ??
    null
  );
}

function selectContainerSection(
  kind: string | null,
  slots: DetailSlots
): DetailContainerSection | null {
  const shouldShow =
    kind === 'pod' ||
    kind === 'deployment' ||
    kind === 'daemonset' ||
    kind === 'statefulset' ||
    kind === 'replicaset';
  if (!shouldShow) {
    return null;
  }

  const containers =
    slots.podDetails?.containers ||
    slots.deploymentDetails?.containers ||
    slots.daemonSetDetails?.containers ||
    slots.statefulSetDetails?.containers ||
    slots.replicaSetDetails?.containers;
  const initContainers =
    slots.podDetails?.initContainers ||
    slots.deploymentDetails?.initContainers ||
    slots.daemonSetDetails?.initContainers ||
    slots.statefulSetDetails?.initContainers ||
    slots.replicaSetDetails?.initContainers;
  const hasContainers = (containers?.length ?? 0) > 0 || (initContainers?.length ?? 0) > 0;
  return hasContainers ? { containers, initContainers } : null;
}

function selectDataSection(kind: string | null, slots: DetailSlots): DetailDataSection | null {
  if (kind === 'configmap' && slots.configMapDetails) {
    return {
      data: slots.configMapDetails.data ?? undefined,
      binaryData: slots.configMapDetails.binaryData ?? undefined,
      isSecret: false,
    };
  }
  if (kind === 'secret' && slots.secretDetails) {
    return {
      data: slots.secretDetails.data ?? undefined,
      binaryData: undefined,
      isSecret: true,
    };
  }
  return null;
}

function selectPortForwardAvailable(kind: string | null, slots: DetailSlots): boolean | undefined {
  switch (kind) {
    case 'pod':
      return slots.podDetails
        ? hasForwardableContainerDetails(slots.podDetails.containers)
        : undefined;
    case 'deployment':
      return slots.deploymentDetails
        ? hasForwardableContainerDetails(slots.deploymentDetails.containers)
        : undefined;
    case 'replicaset':
      return slots.replicaSetDetails
        ? hasForwardableContainerDetails(slots.replicaSetDetails.containers)
        : undefined;
    case 'daemonset':
      return slots.daemonSetDetails
        ? hasForwardableContainerDetails(slots.daemonSetDetails.containers)
        : undefined;
    case 'statefulset':
      return slots.statefulSetDetails
        ? hasForwardableContainerDetails(slots.statefulSetDetails.containers)
        : undefined;
    case 'service':
      return slots.serviceDetails
        ? (slots.serviceDetails.ports?.some(
            (port) => !port.protocol || port.protocol.toUpperCase() === 'TCP'
          ) ?? false)
        : undefined;
    default:
      return undefined;
  }
}

function selectDesiredScaleReplicas(kind: string | null, slots: DetailSlots): number {
  switch (kind) {
    case 'deployment':
      return slots.deploymentDetails?.desiredReplicas ?? 0;
    case 'statefulset':
      return slots.statefulSetDetails?.desiredReplicas ?? 0;
    case 'replicaset':
      return slots.replicaSetDetails?.desiredReplicas ?? 0;
    default:
      return 0;
  }
}
