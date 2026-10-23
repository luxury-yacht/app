import type { types } from '@core/backend-api/models';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import type { DetailTypesWhere } from '@shared/kinds/kindFacets';
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
  /** The Jobs a kind with a Jobs tab owns; null when the detail is not loaded or has no Jobs tab. */
  ownedJobs: types.JobSimpleInfo[] | null;
  actionState: DetailActionState;
}

/** Action-menu inputs, read off whichever detail DTO carries them. */
export interface DetailActionState {
  status?: string;
  ready?: string | number;
  unschedulable?: boolean;
}

type DetailSections = Omit<ObjectDetailModel, 'objectData' | 'activeDetail' | 'actionState'>;

/**
 * Per-detail-type presentation derivations: which detail types render which sibling sections.
 * Sections are declared per type, not inferred from DTO field names — those names are overloaded
 * across kinds (e.g. `rules` on Ingress/Route/Webhook vs RBAC; `containers` on Job). Each entry
 * reads its own DTO's fields, so a renamed backend field fails to compile here instead of
 * rendering an empty section. Sections a kind has because of a kind facet are in the facet tables
 * below instead.
 */
interface DetailDerivations<T> {
  /** Pods + core workloads show a Containers sibling section (Jobs/CronJobs deliberately do not). */
  containerSection?: (detail: T) => DetailContainerSection | null;
  /** Pod exposes its container names for the logs/exec container picker. */
  availableContainers?: (detail: T) => string[];
  /** ConfigMap/Secret show a DataSection; Secret masks its values. */
  dataSection?: (detail: T) => DetailDataSection;
  /** Role/ClusterRole expose RBAC policy rules (rendered by the separate RBACRules section). */
  roleRules?: (detail: T) => PolicyRule[] | undefined;
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

const workloadContainers = { containerSection: containerSectionOf };

const DETAIL_DERIVATIONS: { [K in ObjectDetailType]?: DetailDerivations<ObjectDetailTypes[K]> } = {
  pod: {
    containerSection: containerSectionOf,
    availableContainers: (detail) =>
      detail.containers
        ?.map((container) => container.name?.trim())
        .filter((name): name is string => Boolean(name)) ?? [],
  },
  deployment: workloadContainers,
  replicaset: workloadContainers,
  statefulset: workloadContainers,
  daemonset: workloadContainers,
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
  role: { roleRules: (detail) => detail.rules ?? undefined },
  clusterrole: { roleRules: (detail) => detail.rules ?? undefined },
  namespace: {
    namespaceFinalization: (detail) => ({
      finalizers: detail.finalizers ?? undefined,
      conditions: detail.conditions ?? undefined,
    }),
  },
};

type Accessors<K extends ObjectDetailType, R> = {
  [P in K]: (details: ObjectDetailTypes[P]) => R;
};
type PartialAccessors<R> = { [K in ObjectDetailType]?: (details: ObjectDetailTypes[K]) => R };

// Sections a kind has because of a kind facet. Each table must cover exactly the detail types
// whose kind has the facet (TypeScript rejects a missing or a stale entry), so a facet change in
// the backend kind registry cannot leave its section behind.
/** Workloads/Jobs list their owned pods (NOT Node, whose detail lists pods but not as owner). */
const ACTIVE_POD_NAMES: Accessors<DetailTypesWhere<{ detailListsPods: true }>, string[] | null> = {
  cronjob: podNamesOf,
  daemonset: podNamesOf,
  deployment: podNamesOf,
  job: podNamesOf,
  replicaset: podNamesOf,
  statefulset: podNamesOf,
};
/** The replica count the scale action starts from (NOT HPA, which also carries desiredReplicas). */
const DESIRED_SCALE_REPLICAS: Accessors<DetailTypesWhere<{ actions: { scale: true } }>, number> = {
  deployment: scaleReplicasOf,
  replicaset: scaleReplicasOf,
  statefulset: scaleReplicasOf,
};
/** Whether the target has a TCP port to forward to: container ports, or service ports. */
const PORT_FORWARD_AVAILABLE: Accessors<
  DetailTypesWhere<{ actions: { portForward: true } }>,
  boolean
> = {
  daemonset: podsForwardable,
  deployment: podsForwardable,
  pod: podsForwardable,
  service: (detail) =>
    detail.ports?.some((port) => !port.protocol || port.protocol.toUpperCase() === 'TCP') ?? false,
  statefulset: podsForwardable,
};
/** The suspend toggle's state. */
const SUSPENDED: Accessors<DetailTypesWhere<{ actions: { suspend: true } }>, boolean> = {
  cronjob: (detail) => detail.suspend ?? false,
};
/** The Jobs the Jobs tab lists. */
const OWNED_JOBS: Accessors<DetailTypesWhere<{ panel: { jobs: true } }>, types.JobSimpleInfo[]> = {
  cronjob: (detail) => detail.jobs ?? [],
};

function readFacetSection<K extends ObjectDetailType, R>(
  accessors: PartialAccessors<R>,
  detail: ObjectDetail<K>,
  fallback: R
): R {
  const select: ((details: ObjectDetailTypes[K]) => R) | undefined = accessors[detail.detailType];
  return select ? select(detail.details) : fallback;
}

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
  ownedJobs: null,
};

function deriveDetailSections<K extends ObjectDetailType>(detail: ObjectDetail<K>): DetailSections {
  const derivations: DetailDerivations<ObjectDetailTypes[K]> =
    DETAIL_DERIVATIONS[detail.detailType] ?? {};
  const derive = <R>(select: ((value: ObjectDetailTypes[K]) => R) | undefined, fallback: R): R =>
    select ? select(detail.details) : fallback;
  return {
    activePodNames: readFacetSection(ACTIVE_POD_NAMES, detail, EMPTY_SECTIONS.activePodNames),
    availableContainers: derive(
      derivations.availableContainers,
      EMPTY_SECTIONS.availableContainers
    ),
    containerSection: derive(derivations.containerSection, EMPTY_SECTIONS.containerSection),
    dataSection: derive(derivations.dataSection, EMPTY_SECTIONS.dataSection),
    portForwardAvailable: readFacetSection<K, boolean | undefined>(
      PORT_FORWARD_AVAILABLE,
      detail,
      undefined
    ),
    roleRules: derive(derivations.roleRules, undefined),
    namespaceFinalization: derive(derivations.namespaceFinalization, null),
    desiredScaleReplicas: readFacetSection(DESIRED_SCALE_REPLICAS, detail, 0),
    cronJobSuspended: readFacetSection(SUSPENDED, detail, false),
    ownedJobs: readFacetSection<K, types.JobSimpleInfo[] | null>(OWNED_JOBS, detail, null),
  };
}

type DetailDTO = ObjectDetailTypes[ObjectDetailType];

const scalarOf = (value: unknown): string | number | undefined =>
  typeof value === 'string' || typeof value === 'number' ? value : undefined;

// The action menu reads these generically: any DTO that carries the field supplies it.
const actionStateOf = (details: DetailDTO): DetailActionState => ({
  status: 'status' in details && typeof details.status === 'string' ? details.status : undefined,
  ready: 'ready' in details ? scalarOf(details.ready) : undefined,
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
