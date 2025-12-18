import { types } from '@wailsjs/go/models';
import type { KubernetesObjectReference } from '@/types/view-state';

export interface DetailsTabProps {
  objectData?: KubernetesObjectReference | null;
  isActive?: boolean;
  // Workloads
  podDetails: types.PodDetailInfo | null;
  deploymentDetails: types.DeploymentDetails | null;
  daemonSetDetails: types.DaemonSetDetails | null;
  statefulSetDetails: types.StatefulSetDetails | null;
  jobDetails: types.JobDetails | null;
  cronJobDetails: types.CronJobDetails | null;
  // Configuration
  configMapDetails: types.ConfigMapDetails | null;
  secretDetails: types.SecretDetails | null;
  // Helm
  helmReleaseDetails: types.HelmReleaseDetails | null;
  // Network
  serviceDetails: types.ServiceDetails | null;
  ingressDetails: types.IngressDetails | null;
  networkPolicyDetails: types.NetworkPolicyDetails | null;
  endpointSliceDetails: types.EndpointSliceDetails | null;
  // Storage
  pvcDetails: types.PersistentVolumeClaimDetails | null;
  pvDetails: types.PersistentVolumeDetails | null;
  storageClassDetails: types.StorageClassDetails | null;
  // RBAC
  serviceAccountDetails: types.ServiceAccountDetails | null;
  roleDetails: types.RoleDetails | null;
  roleBindingDetails: types.RoleBindingDetails | null;
  clusterRoleDetails: types.ClusterRoleDetails | null;
  clusterRoleBindingDetails: types.ClusterRoleBindingDetails | null;
  // Autoscaling
  hpaDetails: types.HorizontalPodAutoscalerDetails | null;
  // Policy
  pdbDetails: types.PodDisruptionBudgetDetails | null;
  resourceQuotaDetails: types.ResourceQuotaDetails | null;
  limitRangeDetails: types.LimitRangeDetails | null;
  // Cluster Resources
  nodeDetails: types.NodeDetails | null;
  namespaceDetails: types.NamespaceDetails | null;
  ingressClassDetails: types.IngressClassDetails | null;
  // CRDs and Webhooks
  crdDetails: types.CustomResourceDefinitionDetails | null;
  mutatingWebhookDetails: types.MutatingWebhookConfigurationDetails | null;
  validatingWebhookDetails: types.ValidatingWebhookConfigurationDetails | null;
  detailsLoading: boolean;
  detailsError: string | null;
  resourceDeleted?: boolean;
  deletedResourceName?: string;
  canRestart: boolean;
  canScale: boolean;
  canDelete: boolean;
  restartDisabledReason?: string;
  scaleDisabledReason?: string;
  deleteDisabledReason?: string;
  actionLoading: boolean;
  actionError: string | null;
  scaleReplicas: number;
  showScaleInput: boolean;
  onRestartClick: () => void;
  onDeleteClick: () => void;
  onScaleClick: (replicas?: number) => void;
  onScaleCancel: () => void;
  onScaleReplicasChange: (value: number) => void;
  onShowScaleInput: () => void;
}

export interface OverviewData {
  kind: string;
  name: string;
  age: string;
  namespace?: string;
  status?: string;
  statusSeverity?: string;
  node?: string;
  nodeIP?: string;
  podIP?: string;
  owner?: { kind: string; name: string };
  ready?: string;
  restarts?: number;
  qosClass?: string;
  priorityClass?: string;
  serviceAccount?: string;
  hostNetwork?: boolean;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  apiGroup?: string;
  // Deployment/StatefulSet/DaemonSet fields
  replicas?: number;
  desiredReplicas?: number;
  upToDate?: number;
  available?: number;
  strategy?: string;
  maxSurge?: string;
  maxUnavailable?: string;
  minReadySeconds?: number;
  revisionHistory?: number;
  progressDeadline?: number;
  paused?: boolean;
  rolloutStatus?: string;
  rolloutMessage?: string;
  observedGeneration?: number;
  currentRevision?: string;
  selector?: Record<string, string>;
  conditions?: any[];
  replicaSets?: any[];
  // DaemonSet specific
  desired?: number;
  current?: number;
  updateStrategy?: string;
  numberMisscheduled?: number;
  // StatefulSet specific
  serviceName?: string;
  podManagementPolicy?: string;
  // ConfigMap/Secret
  configMapDetails?: any;
  secretDetails?: any;
  // Helm
  chart?: string;
  appVersion?: string;
  revision?: number;
  updated?: string;
  helmReleaseDetails?: any;
  // Service/Ingress/Network
  serviceDetails?: any;
  ingressDetails?: any;
  networkPolicyDetails?: any;
  endpointSliceDetails?: any;
  // RBAC
  secrets?: string[];
  imagePullSecrets?: string[];
  automountServiceAccountToken?: boolean;
  usedBy?: any[];
  roleBindings?: any[];
  clusterRoleBindings?: any[];
  policyRules?: any[];
  aggregationRule?: any;
  usedByRoleBindings?: any[];
  roleRef?: any;
  subjects?: any[];
  // Node
  roles?: string[];
  version?: string;
  os?: string;
  osImage?: string;
  architecture?: string;
  containerRuntime?: string;
  kernelVersion?: string;
  kubeletVersion?: string;
  hostname?: string;
  internalIP?: string;
  externalIP?: string;
  cpuCapacity?: string;
  cpuAllocatable?: string;
  memoryCapacity?: string;
  memoryAllocatable?: string;
  podsCapacity?: string;
  podsAllocatable?: string;
  storageCapacity?: string;
  podsCount?: number;
  cpuRequests?: string;
  cpuLimits?: string;
  memRequests?: string;
  memLimits?: string;
  taints?: any[];
  // Job
  completions?: number;
  parallelism?: number;
  backoffLimit?: number;
  succeeded?: number;
  failed?: number;
  active?: number;
  startTime?: string;
  completionTime?: string;
  duration?: string;
  // CronJob
  schedule?: string;
  suspend?: boolean;
  activeJobs?: number;
  lastScheduleTime?: string;
  successfulJobsHistory?: number;
  failedJobsHistory?: number;
  // PVC
  volumeName?: string;
  capacity?: string;
  accessModes?: string[];
  storageClass?: string;
  volumeMode?: string;
  mountedBy?: string[];
  // PV
  reclaimPolicy?: string;
  claimRef?: any;
  // StorageClass
  provisioner?: string;
  volumeBindingMode?: string;
  allowVolumeExpansion?: boolean;
  isDefault?: boolean;
  parameters?: Record<string, string>;
  // HPA
  scaleTargetRef?: any;
  minReplicas?: number;
  maxReplicas?: number;
  currentReplicas?: number;
  metrics?: any[];
  currentMetrics?: any[];
  behavior?: any;
  // PDB
  minAvailable?: string;
  currentHealthy?: number;
  desiredHealthy?: number;
  disruptionsAllowed?: number;
  expectedPods?: number;
  // ResourceQuota
  hard?: Record<string, string>;
  used?: Record<string, string>;
  scopes?: string[];
  scopeSelector?: any;
  // LimitRange
  limits?: any[];
  // Namespace
  hasWorkloads?: boolean;
  workloadsUnknown?: boolean;
  // IngressClass
  controller?: string;
  // CRD
  group?: string;
  versions?: any[];
  scope?: string;
  names?: any;
  // Webhooks
  webhooks?: any[];
}

export interface UtilizationData {
  cpu?: {
    usage: string;
    request?: string;
    limit?: string;
    capacity?: string;
    allocatable?: string;
  };
  memory?: {
    usage: string;
    request?: string;
    limit?: string;
    capacity?: string;
    allocatable?: string;
  };
  pods?: {
    count: string;
    capacity: string;
    allocatable: string;
  };
  mode?: 'nodeMetrics';
  isAverage?: boolean;
  podCount?: number;
}

export interface DataInfo {
  data?: Record<string, string>;
  binaryData?: Record<string, string>;
  isSecret: boolean;
}
