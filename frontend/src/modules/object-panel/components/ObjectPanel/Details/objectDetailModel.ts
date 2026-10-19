import type { types } from '@core/backend-api/models';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import type { ObjectDetail, ObjectDetailType, ObjectDetailTypes } from '@/core/refresh/types';

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
  ports?: string[] | null;
};

type PolicyRule = types.PolicyRule;

export interface DetailDataSection {
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  isSecret: boolean;
}

export interface DetailContainerSection {
  containers?: DetailContainer[];
  initContainers?: DetailContainer[];
}

export interface DetailCondition {
  type?: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface NamespaceFinalizationDetails {
  finalizers?: string[];
  conditions?: DetailCondition[];
}

export interface ObjectDetailModel {
  objectData: ObjectPanelRef | null;
  /** The active detail DTO tagged with its type; the renderer and tabs narrow on `detailType`. */
  activeDetail: ObjectDetail | null;
  activePodNames: string[] | null;
  availableContainers: string[];
  containerSection: DetailContainerSection | null;
  dataSection: DetailDataSection | null;
  portForwardAvailable: boolean | undefined;
  roleRules?: PolicyRule[];
  namespaceFinalization: NamespaceFinalizationDetails | null;
  desiredScaleReplicas: number;
  cronJobSuspended: boolean;
  actionState: DetailActionState;
}

/** Action-menu inputs, read off whichever detail DTO carries them. */
export interface DetailActionState {
  status?: string;
  ready?: string | number;
  replicas?: string | number;
  unschedulable?: boolean;
}

type DetailSections = Omit<ObjectDetailModel, 'objectData' | 'activeDetail' | 'actionState'>;

/**
 * Per-detail-type derivations: the single source of truth for which detail types feed which panel
 * sections. Capabilities are declared per type, not inferred from DTO field names — those names are
 * overloaded across kinds (e.g. `rules` on Ingress/Route/Webhook vs RBAC; `containers` on Job;
 * `desiredReplicas` on HPA; `pods` on Node). Each entry reads its own DTO's fields, so a renamed
 * backend field fails to compile here instead of rendering an empty section.
 */
interface DetailDerivations<T> {
  /** Pods + core workloads show a Containers sibling section (Jobs/CronJobs deliberately do not). */
  containerSection?: (detail: T) => DetailContainerSection | null;
  /** Pod exposes its container names for the logs/exec container picker. */
  availableContainers?: (detail: T) => string[];
  /** ConfigMap/Secret show a DataSection; Secret masks its values. */
  dataSection?: (detail: T) => DetailDataSection;
  /** Port-forward availability, from container ports or service ports. */
  portForwardAvailable?: (detail: T) => boolean;
  /** Scalable via the scale action (NOT HPA, which also carries desiredReplicas). */
  desiredScaleReplicas?: (detail: T) => number;
  /** Role/ClusterRole expose RBAC policy rules (rendered by the separate RBACRules section). */
  roleRules?: (detail: T) => PolicyRule[] | undefined;
  /** Workloads/Jobs surface their owned pods (NOT Node, which also carries `pods`). */
  activePodNames?: (detail: T) => string[] | null;
  /** CronJob surfaces its suspend toggle. */
  cronJobSuspended?: (detail: T) => boolean;
  /** Namespace carries spec.finalizers and controller-authored deletion conditions. */
  namespaceFinalization?: (detail: T) => NamespaceFinalizationDetails;
}

const NON_TCP_PORT_SUFFIX = /\/(UDP|SCTP)$/i;

const hasForwardableContainerDetails = (
  containers?: Array<{ ports?: string[] | null }> | null
): boolean =>
  containers?.some((container) =>
    container.ports?.some((port) => !NON_TCP_PORT_SUFFIX.test(port))
  ) ?? false;

// An empty list is a workload without pods; a missing list (still loading, or
// pods the backend could not list) is unknown.
const extractPodNames = (pods?: Array<{ name?: string | null }> | null): string[] | null => {
  if (!pods) {
    return null;
  }
  return pods
    .map((pod) => (typeof pod.name === 'string' ? pod.name.trim() : ''))
    .filter((name) => name.length > 0);
};

interface WithContainers {
  containers?: DetailContainer[] | null;
  initContainers?: DetailContainer[] | null;
}

const containerSectionOf = (detail: WithContainers): DetailContainerSection | null => {
  const containers = detail.containers ?? undefined;
  const initContainers = detail.initContainers ?? undefined;
  const hasContainers = (containers?.length ?? 0) > 0 || (initContainers?.length ?? 0) > 0;
  return hasContainers ? { containers, initContainers } : null;
};

const podsForwardable = (detail: WithContainers): boolean =>
  hasForwardableContainerDetails(detail.containers);

const podNamesOf = (detail: { pods?: Array<{ name?: string | null }> | null }) =>
  extractPodNames(detail.pods);

const scaleReplicasOf = (detail: { desiredReplicas?: number }) => detail.desiredReplicas ?? 0;

// Generated map types allow absent values; a Go map[string]string never holds one.
const stringMap = (
  values: Record<string, string | undefined> | null | undefined
): Record<string, string> | undefined =>
  values
    ? Object.fromEntries(
        Object.entries(values).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    : undefined;

const scalableWorkload = {
  containerSection: containerSectionOf,
  portForwardAvailable: podsForwardable,
  desiredScaleReplicas: scaleReplicasOf,
  activePodNames: podNamesOf,
};

const DETAIL_DERIVATIONS: { [K in ObjectDetailType]?: DetailDerivations<ObjectDetailTypes[K]> } = {
  pod: {
    containerSection: containerSectionOf,
    availableContainers: (detail) =>
      detail.containers
        ?.map((container) => container.name?.trim())
        .filter((name): name is string => Boolean(name)) ?? [],
    portForwardAvailable: podsForwardable,
  },
  deployment: scalableWorkload,
  replicaset: scalableWorkload,
  statefulset: scalableWorkload,
  daemonset: {
    containerSection: containerSectionOf,
    portForwardAvailable: podsForwardable,
    activePodNames: podNamesOf,
  },
  job: { activePodNames: podNamesOf },
  cronjob: { activePodNames: podNamesOf, cronJobSuspended: (detail) => detail.suspend ?? false },
  configmap: {
    dataSection: (detail) => ({
      data: stringMap(detail.data),
      binaryData: stringMap(detail.binaryData),
      isSecret: false,
    }),
  },
  secret: {
    dataSection: (detail) => ({
      data: stringMap(detail.data),
      binaryData: undefined,
      isSecret: true,
    }),
  },
  service: {
    portForwardAvailable: (detail) =>
      detail.ports?.some((port) => !port.protocol || port.protocol.toUpperCase() === 'TCP') ??
      false,
  },
  role: { roleRules: (detail) => detail.rules ?? undefined },
  clusterrole: { roleRules: (detail) => detail.rules ?? undefined },
  namespace: {
    namespaceFinalization: (detail) => ({
      finalizers: detail.finalizers ?? undefined,
      conditions: detail.conditions ?? undefined,
    }),
  },
};

const EMPTY_SECTIONS: DetailSections = {
  activePodNames: null,
  availableContainers: [],
  containerSection: null,
  dataSection: null,
  portForwardAvailable: undefined,
  roleRules: undefined,
  namespaceFinalization: null,
  desiredScaleReplicas: 0,
  cronJobSuspended: false,
};

function deriveDetailSections<K extends ObjectDetailType>(detail: ObjectDetail<K>): DetailSections {
  const derivations: DetailDerivations<ObjectDetailTypes[K]> =
    DETAIL_DERIVATIONS[detail.detailType] ?? {};
  const derive = <R>(select: ((value: ObjectDetailTypes[K]) => R) | undefined, fallback: R): R =>
    select ? select(detail.details) : fallback;
  return {
    activePodNames: derive(derivations.activePodNames, EMPTY_SECTIONS.activePodNames),
    availableContainers: derive(
      derivations.availableContainers,
      EMPTY_SECTIONS.availableContainers
    ),
    containerSection: derive(derivations.containerSection, EMPTY_SECTIONS.containerSection),
    dataSection: derive(derivations.dataSection, EMPTY_SECTIONS.dataSection),
    portForwardAvailable: derive(derivations.portForwardAvailable, undefined),
    roleRules: derive(derivations.roleRules, undefined),
    namespaceFinalization: derive(derivations.namespaceFinalization, null),
    desiredScaleReplicas: derive(derivations.desiredScaleReplicas, 0),
    cronJobSuspended: derive(derivations.cronJobSuspended, false),
  };
}

type DetailDTO = ObjectDetailTypes[ObjectDetailType];

const scalarOf = (value: unknown): string | number | undefined =>
  typeof value === 'string' || typeof value === 'number' ? value : undefined;

// The action menu reads these generically: any DTO that carries the field supplies it.
const actionStateOf = (details: DetailDTO): DetailActionState => ({
  status: 'status' in details && typeof details.status === 'string' ? details.status : undefined,
  ready: 'ready' in details ? scalarOf(details.ready) : undefined,
  replicas: 'replicas' in details ? scalarOf(details.replicas) : undefined,
  unschedulable:
    'unschedulable' in details && typeof details.unschedulable === 'boolean'
      ? details.unschedulable
      : undefined,
});

export function buildObjectDetailModel(
  objectData: ObjectPanelRef | null,
  detail: ObjectDetail | null
): ObjectDetailModel {
  return {
    objectData: objectData ?? null,
    activeDetail: detail,
    ...(detail ? deriveDetailSections(detail) : EMPTY_SECTIONS),
    actionState: detail ? actionStateOf(detail.details) : {},
  };
}
