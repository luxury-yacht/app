/**
 * frontend/src/shared/hooks/useNodeMaintenanceActions.tsx
 *
 * Centralised hook for the Node-only maintenance actions (cordon, uncordon,
 * drain). Both the cluster nodes grid and the object panel's actions menu use
 * this so the cordon confirmations and the drain modal live in one place.
 *
 * Returns:
 *   - handlers: callbacks suitable for the action menu (open the relevant modal)
 *   - modals: JSX to render once at the consumer site
 *   - openDrainFor / activeDrainFor: helpers for the drain status icon
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import DrainNodeModal from '@shared/components/modals/DrainNodeModal';
import { CordonNode, UncordonNode } from '@wailsjs/go/backend/App';
import { errorHandler } from '@/utils/errorHandler';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import { requestRefreshDomain } from '@/core/data-access';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { NodeMaintenanceDrainJob, NodeMaintenanceSnapshotPayload } from '@/core/refresh/types';

export interface NodeActionTarget {
  clusterId: string;
  clusterName?: string;
  name: string;
  unschedulable?: boolean;
}

type NodeMaintenanceSnapshotState = ReturnType<typeof useRefreshScopedDomain> & {
  data: NodeMaintenanceSnapshotPayload | null;
};

export interface UseNodeMaintenanceActionsOptions {
  /**
   * When provided, all cluster IDs in this set get a maintenance refresh
   * subscription so the drain icon next to each Node row stays live without
   * the consumer having to manage subscriptions itself. The hook only
   * subscribes; jobs come back through the shared refresh-domain cache.
   */
  watchClusterIds?: string[];
  onAfterAction?: (action: 'cordon' | 'uncordon' | 'drain', target: NodeActionTarget) => void;
}

export const useNodeMaintenanceActions = ({
  watchClusterIds,
  onAfterAction,
}: UseNodeMaintenanceActionsOptions = {}) => {
  const [cordonTarget, setCordonTarget] = useState<NodeActionTarget | null>(null);
  const [drainTarget, setDrainTarget] = useState<NodeActionTarget | null>(null);
  const [cordonPending, setCordonPending] = useState(false);

  const watchKey = useMemo(
    () => (watchClusterIds ?? []).slice().sort().join('|'),
    [watchClusterIds]
  );

  // Aggregate snapshot across the watched clusters so the drain icon can find
  // active drains for any node row without each consumer wiring its own scope.
  const aggregateSnapshot = useRefreshScopedDomain(
    'object-maintenance',
    watchKey ? `aggregate:${watchKey}` : ''
  ) as NodeMaintenanceSnapshotState;

  useEffect(() => {
    if (!watchClusterIds?.length) return;
    const scopes = watchClusterIds.map((clusterId) => buildClusterScope(clusterId, 'aggregate'));
    scopes.forEach((scope) => {
      refreshOrchestrator.setScopedDomainEnabled('object-maintenance', scope, true);
      void requestRefreshDomain({
        domain: 'object-maintenance',
        scope,
        reason: 'startup',
      });
    });
    return () => {
      scopes.forEach((scope) => {
        refreshOrchestrator.setScopedDomainEnabled('object-maintenance', scope, false);
      });
    };
  }, [watchClusterIds]);

  const aggregateDrains = useMemo<NodeMaintenanceDrainJob[]>(
    () => aggregateSnapshot.data?.drains ?? [],
    [aggregateSnapshot.data]
  );

  const activeDrainFor = useCallback(
    (clusterId: string, nodeName: string): NodeMaintenanceDrainJob | null => {
      if (!clusterId || !nodeName) return null;
      const cid = clusterId.trim();
      const name = nodeName.trim().toLowerCase();
      return (
        aggregateDrains.find(
          (job) =>
            (job.status === 'running' || job.status === 'canceling') &&
            job.clusterId === cid &&
            job.nodeName === name
        ) ?? null
      );
    },
    [aggregateDrains]
  );

  const openCordonFor = useCallback((target: NodeActionTarget) => {
    setCordonTarget(target);
  }, []);

  const openDrainFor = useCallback((target: NodeActionTarget) => {
    setDrainTarget(target);
  }, []);

  const confirmCordon = useCallback(async () => {
    const target = cordonTarget;
    if (!target || cordonPending) return;
    setCordonPending(true);
    const action: 'cordon' | 'uncordon' = target.unschedulable ? 'uncordon' : 'cordon';
    try {
      if (action === 'cordon') {
        await CordonNode(target.clusterId, target.name);
      } else {
        await UncordonNode(target.clusterId, target.name);
      }
      onAfterAction?.(action, target);
    } catch (error) {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: 'node-maintenance',
        action,
        name: target.name,
      });
    } finally {
      setCordonPending(false);
      setCordonTarget(null);
    }
  }, [cordonPending, cordonTarget, onAfterAction]);

  const cordonConfirmation = useMemo(() => {
    if (!cordonTarget) return null;
    if (cordonTarget.unschedulable) {
      return {
        title: 'Uncordon Node',
        message: `Uncordon node "${cordonTarget.name}"?\n\nNew workloads will be allowed to schedule.`,
        confirmText: 'Uncordon',
      };
    }
    return {
      title: 'Cordon Node',
      message: `Cordon node "${cordonTarget.name}"?\n\nThis prevents new workloads from being scheduled until it is uncordoned.`,
      confirmText: 'Cordon',
    };
  }, [cordonTarget]);

  const handlers = useMemo(
    () => ({
      onCordon: openCordonFor,
      onDrain: openDrainFor,
    }),
    [openCordonFor, openDrainFor]
  );

  const modals = (
    <>
      <ConfirmationModal
        isOpen={Boolean(cordonTarget)}
        title={cordonConfirmation?.title ?? ''}
        message={cordonConfirmation?.message ?? ''}
        confirmText={cordonConfirmation?.confirmText}
        confirmButtonClass="warning"
        onConfirm={confirmCordon}
        onCancel={() => setCordonTarget(null)}
      />
      {drainTarget && (
        <DrainNodeModal
          isOpen
          clusterId={drainTarget.clusterId}
          clusterName={drainTarget.clusterName}
          nodeName={drainTarget.name}
          onClose={() => setDrainTarget(null)}
        />
      )}
    </>
  );

  return {
    handlers,
    modals,
    openCordonFor,
    openDrainFor,
    activeDrainFor,
  };
};
