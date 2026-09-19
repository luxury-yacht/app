/**
 * frontend/src/modules/namespace/components/workloadActionReference.ts
 *
 * Builds object-action references for namespace workload rows so action facts
 * are projected consistently before they reach the shared action controller.
 */

import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import type { WorkloadData } from './NsViewWorkloads.helpers';

export const normalizeWorkloadHPAManaged = (value: WorkloadData['hpaManaged'] | null) => {
  if (value === true) {
    return true;
  } else if (value === false) {
    return false;
  } else {
    return null;
  }
};

export const buildWorkloadActionReference = (
  row: WorkloadData,
  fallbackClusterId?: string | null,
  clusterName?: string | null
) =>
  buildRequiredObjectReference(
    {
      ...row.ref,
      clusterName: clusterName || undefined,
    },
    { fallbackClusterId },
    {
      status: row.status,
      ready: row.ready,
      portForwardAvailable: row.portForwardAvailable,
      hpaManaged: normalizeWorkloadHPAManaged(row.hpaManaged),
      desiredReplicas: row.desiredReplicas,
    }
  );
