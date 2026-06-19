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
  /** Called after a successful delete so the panel can close. */
  onAfterDelete: () => void;
  /** Called after a successful restart/scale/trigger/suspend so the panel can refetch. */
  onAfterAction: () => void;
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
