/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/detailsTabTypes.ts
 *
 * Type definitions for detailsTabTypes.
 * Defines shared interfaces and payload shapes for the object panel feature.
 */

import type { CapabilityState } from '@modules/object-panel/components/ObjectPanel/types';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import type { ObjectDeletionMetadata } from '@/core/refresh/types.generated';
import type { ObjectDetailModel } from './objectDetailModel';

export interface DetailsTabProps {
  objectData?: ObjectPanelRef | null;
  detailModel: ObjectDetailModel;
  isActive?: boolean;
  detailsLoading: boolean;
  detailsError: string | null;
  deletion?: ObjectDeletionMetadata | null;
  finalizerRemovalCapabilities: {
    metadata: CapabilityState;
    namespaceSpec: CapabilityState;
  };
  resourceDeleted?: boolean;
  deletedResourceName?: string;
  /** Called after a successful delete so the panel can close. */
  onAfterDelete: () => void;
  /** Called after a successful restart/scale/trigger/suspend so the panel can refetch. */
  onAfterAction: () => void;
}

export interface UtilizationData {
  cpu?: {
    usage?: string;
    request?: string;
    limit?: string;
    capacity?: string;
    allocatable?: string;
  };
  memory?: {
    usage?: string;
    request?: string;
    limit?: string;
    capacity?: string;
    allocatable?: string;
  };
  pods?: {
    count?: string;
    capacity?: string;
    allocatable?: string;
  };
  mode?: 'nodeMetrics';
  podCount?: number;
  readyPodCount?: number;
}
