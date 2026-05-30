/**
 * frontend/src/modules/namespace/components/workloadActionReference.ts
 *
 * Builds object-action references for namespace workload rows so action facts
 * are projected consistently before they reach the shared action controller.
 */

import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import type { WorkloadData } from './NsViewWorkloads.helpers';

export const normalizeWorkloadHPAManaged = (value: WorkloadData['hpaManaged']) =>
  value === true ? true : value === false ? false : null;

export const buildWorkloadActionReference = (
  row: WorkloadData,
  fallbackClusterId?: string | null
) =>
  buildRequiredObjectReference(
    {
      kind: row.kind,
      name: row.name,
      namespace: row.namespace,
      clusterId: row.clusterId,
      clusterName: row.clusterName,
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
