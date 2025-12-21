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
