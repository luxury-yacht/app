import type { KubernetesObjectReference } from '@/types/view-state';

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
  /** The raw active-kind detail DTO (the backend-emitted payload), fed to the descriptor renderer. */
  activeDetail: unknown;
  activePodNames: string[] | null;
  availableContainers: string[];
  containerSection: DetailContainerSection | null;
  dataSection: DetailDataSection | null;
  portForwardAvailable: boolean | undefined;
  roleRules?: PolicyRule[];
  desiredScaleReplicas: number;
  cronJobSuspended: boolean;
}

/**
 * Per-kind detail config — the single source of truth for the derivation capabilities that used to
 * be scattered kind-lists inside the `select*` helpers. With a single active DTO (no slots union),
 * capabilities MUST be declared, not inferred from DTO field names — those names are overloaded
 * across kinds (e.g. `rules` on Ingress/Route/Webhook vs RBAC; `containers` on Job; `desiredReplicas`
 * on HPA; `pods` on Node).
 */
interface DetailKindConfig {
  /** Pods + core workloads show a Containers sibling section (Jobs/CronJobs deliberately do not). */
  showsContainers?: boolean;
  /** Pod exposes its container names for the logs/exec container picker. */
  containerNames?: boolean;
  /** ConfigMap/Secret show a DataSection; Secret masks its values. */
  dataSection?: 'plain' | 'secret';
  /** Port-forward availability is derived from container ports ('pods') or service ports. */
  portForward?: 'pods' | 'service';
  /** Scalable via the scale action (NOT HPA, which also carries desiredReplicas). */
  scalable?: boolean;
  /** Role/ClusterRole expose RBAC policy rules (rendered by the separate RBACRules section). */
  roleRules?: boolean;
  /** Workloads/Jobs surface their owned pods (NOT Node, which also carries `pods`). */
  activePods?: boolean;
  /** CronJob surfaces its suspend toggle. */
  cronSuspend?: boolean;
}

const DETAIL_KIND_CONFIG: Record<string, DetailKindConfig> = {
  pod: { showsContainers: true, containerNames: true, portForward: 'pods' },
  deployment: { showsContainers: true, portForward: 'pods', scalable: true, activePods: true },
  replicaset: { showsContainers: true, portForward: 'pods', scalable: true },
  daemonset: { showsContainers: true, portForward: 'pods', activePods: true },
  statefulset: { showsContainers: true, portForward: 'pods', scalable: true, activePods: true },
  job: { activePods: true },
  cronjob: { activePods: true, cronSuspend: true },
  configmap: { dataSection: 'plain' },
  secret: { dataSection: 'secret' },
  service: { portForward: 'service' },
  role: { roleRules: true },
  clusterrole: { roleRules: true },
};

type DerivableContainer = DetailContainer & { ports?: string[] | null };

/** Structural view of the active DTO for the derivations (each kind's DTO is a superset of this). */
interface DerivableDetail {
  containers?: DerivableContainer[];
  initContainers?: DerivableContainer[];
  pods?: Array<{ name?: string | null }> | null;
  desiredReplicas?: number;
  suspend?: boolean;
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  rules?: PolicyRule[];
  ports?: Array<{ protocol?: string }> | null;
}

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
  const kind = objectKind?.toLowerCase() ?? objectData?.kind?.toLowerCase() ?? null;
  const config = kind ? DETAIL_KIND_CONFIG[kind] : undefined;
  const detail = (detailPayload ?? undefined) as DerivableDetail | undefined;

  return {
    objectData: objectData ?? null,
    objectKind: kind,
    activeDetail: detailPayload ?? null,
    activePodNames: config?.activePods ? extractPodNames(detail?.pods) : null,
    availableContainers: config?.containerNames
      ? (detail?.containers
          ?.map((container) => container.name?.trim())
          .filter((name): name is string => Boolean(name)) ?? [])
      : [],
    containerSection: selectContainerSection(config, detail),
    dataSection: selectDataSection(config, detail),
    portForwardAvailable: selectPortForwardAvailable(config, detail),
    roleRules: config?.roleRules ? detail?.rules : undefined,
    desiredScaleReplicas: config?.scalable ? (detail?.desiredReplicas ?? 0) : 0,
    cronJobSuspended: config?.cronSuspend ? (detail?.suspend ?? false) : false,
  };
}

function selectContainerSection(
  config: DetailKindConfig | undefined,
  detail: DerivableDetail | undefined
): DetailContainerSection | null {
  if (!config?.showsContainers || !detail) {
    return null;
  }
  const containers = detail.containers;
  const initContainers = detail.initContainers;
  const hasContainers = (containers?.length ?? 0) > 0 || (initContainers?.length ?? 0) > 0;
  return hasContainers ? { containers, initContainers } : null;
}

function selectDataSection(
  config: DetailKindConfig | undefined,
  detail: DerivableDetail | undefined
): DetailDataSection | null {
  if (!config?.dataSection || !detail) {
    return null;
  }
  if (config.dataSection === 'plain') {
    return {
      data: detail.data ?? undefined,
      binaryData: detail.binaryData ?? undefined,
      isSecret: false,
    };
  }
  return { data: detail.data ?? undefined, binaryData: undefined, isSecret: true };
}

function selectPortForwardAvailable(
  config: DetailKindConfig | undefined,
  detail: DerivableDetail | undefined
): boolean | undefined {
  if (!detail) {
    return undefined;
  }
  if (config?.portForward === 'pods') {
    return hasForwardableContainerDetails(detail.containers);
  }
  if (config?.portForward === 'service') {
    return (
      detail.ports?.some((port) => !port.protocol || port.protocol.toUpperCase() === 'TCP') ?? false
    );
  }
  return undefined;
}
