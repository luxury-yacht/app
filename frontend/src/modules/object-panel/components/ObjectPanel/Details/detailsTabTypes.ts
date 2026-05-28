/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/detailsTabTypes.ts
 *
 * Type definitions for detailsTabTypes.
 * Defines shared interfaces and payload shapes for the object panel feature.
 */

import type { KubernetesObjectReference } from '@/types/view-state';
import type { ObjectDetailModel } from './objectDetailModel';

export interface DetailsTabProps {
  objectData?: KubernetesObjectReference | null;
  detailModel: ObjectDetailModel;
  isActive?: boolean;
  detailsLoading: boolean;
  detailsError: string | null;
  resourceDeleted?: boolean;
  deletedResourceName?: string;
  canRestart: boolean;
  canScale: boolean;
  canDelete: boolean;
  canTrigger?: boolean;
  canSuspend?: boolean;
  restartDisabledReason?: string;
  scaleDisabledReason?: string;
  deleteDisabledReason?: string;
  actionLoading: boolean;
  actionError: string | null;
  scaleReplicas: number;
  showScaleInput: boolean;
  onRestartClick: () => void;
  onRollbackClick?: () => void;
  onDeleteClick: () => void;
  onScaleClick: (replicas?: number) => void;
  onScaleCancel: () => void;
  onScaleReplicasChange: (value: number) => void;
  onShowScaleInput: () => void;
  onTriggerClick?: () => void;
  onSuspendToggle?: () => void;
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
  podCount?: number;
  readyPodCount?: number;
}
