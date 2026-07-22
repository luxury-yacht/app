/**
 * frontend/src/modules/namespace/components/workloadActionReference.ts
 *
 * Builds object-action references for namespace workload rows so action facts
 * are projected consistently before they reach the shared action controller.
 */

import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import type { WorkloadData } from './NsViewWorkloads.helpers';

export const normalizeWorkloadHPAManaged = (value: WorkloadData['hpaManaged'] | null) =>
  value === true ? true : value === false ? false : null;

export const buildWorkloadActionReference = (
  row: WorkloadData,
  fallbackClusterId?: string | null,
  clusterName?: string | null
) =>
  buildRequiredObjectReference(
    {
      kind: row.ref.kind,
      name: row.ref.name,
      namespace: row.ref.namespace,
      clusterId: row.ref.clusterId,
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
