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
import {
  buildObjectActionTarget,
  runNodeCordon,
  runNodeUncordon,
} from '@shared/actions/objectActionClient';
import { errorHandler } from '@/utils/errorHandler';
import { getPermissionKey, useUserPermissions } from '@/core/capabilities';
import { refreshOrchestrator } from '@/core/refresh';
import { requestRefreshDomain } from '@/core/data-access';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useRefreshScopedDomainEntries, type DomainSnapshotState } from '@/core/refresh/store';
import type { NodeMaintenanceDrainJob, NodeMaintenanceSnapshotPayload } from '@/core/refresh/types';
import { resolveNodeDrainOperationPermissions } from '@shared/hooks/nodeActionPermissions';

export interface NodeActionTarget {
  clusterId: string;
  clusterName?: string;
  name: string;
  unschedulable?: boolean;
}

type NodeMaintenanceSnapshotState = DomainSnapshotState<NodeMaintenanceSnapshotPayload>;

const NODE_MAINTENANCE_AGGREGATE_SCOPE = 'aggregate';

const normalizeWatchClusterIds = (clusterIds: string[] | undefined): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const clusterId of clusterIds ?? []) {
    const trimmed = clusterId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result.sort();
};

export const buildNodeMaintenanceAggregateScope = (clusterId: string): string =>
  buildClusterScope(clusterId, NODE_MAINTENANCE_AGGREGATE_SCOPE);

export const collectNodeMaintenanceDrains = (
  entries: Array<[string, NodeMaintenanceSnapshotState]>,
  scopes: string[]
): NodeMaintenanceDrainJob[] => {
  if (scopes.length === 0) return [];
  const watched = new Set(scopes);
  return entries.flatMap(([scope, state]) =>
    watched.has(scope) ? (state.data?.drains ?? []) : []
  );
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
  const permissionMap = useUserPermissions();

  const watchedClusterIds = useMemo(
    () => normalizeWatchClusterIds(watchClusterIds),
    [watchClusterIds]
  );

  const watchedAggregateScopes = useMemo(
    () => watchedClusterIds.map(buildNodeMaintenanceAggregateScope),
    [watchedClusterIds]
  );

  const objectMaintenanceEntries = useRefreshScopedDomainEntries('object-maintenance') as Array<
    [string, NodeMaintenanceSnapshotState]
  >;

  useEffect(() => {
    if (watchedAggregateScopes.length === 0) return;
    watchedAggregateScopes.forEach((scope) => {
      refreshOrchestrator.setScopedDomainEnabled('object-maintenance', scope, true);
      void requestRefreshDomain({
        domain: 'object-maintenance',
        scope,
        reason: 'startup',
      });
    });
    return () => {
      watchedAggregateScopes.forEach((scope) => {
        refreshOrchestrator.setScopedDomainEnabled('object-maintenance', scope, false);
      });
    };
  }, [watchedAggregateScopes]);

  const aggregateDrains = useMemo<NodeMaintenanceDrainJob[]>(
    () => collectNodeMaintenanceDrains(objectMaintenanceEntries, watchedAggregateScopes),
    [objectMaintenanceEntries, watchedAggregateScopes]
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

  const getDrainPermissions = useCallback(
    (clusterId: string) =>
      resolveNodeDrainOperationPermissions({
        nodeGet:
          permissionMap.get(getPermissionKey('Node', 'get', null, null, clusterId, '', 'v1')) ??
          null,
        nodePatch:
          permissionMap.get(getPermissionKey('Node', 'patch', null, null, clusterId, '', 'v1')) ??
          null,
        podEvictionCreate:
          permissionMap.get(
            getPermissionKey('Pod', 'create', null, 'eviction', clusterId, '', 'v1')
          ) ?? null,
        podDelete:
          permissionMap.get(getPermissionKey('Pod', 'delete', null, null, clusterId, '', 'v1')) ??
          null,
      }),
    [permissionMap]
  );

  const confirmCordon = useCallback(async () => {
    const target = cordonTarget;
    if (!target || cordonPending) return;
    setCordonPending(true);
    const action: 'cordon' | 'uncordon' = target.unschedulable ? 'uncordon' : 'cordon';
    try {
      if (action === 'cordon') {
        await runNodeCordon(buildObjectActionTarget({ ...target, kind: 'Node' }, action));
      } else {
        await runNodeUncordon(buildObjectActionTarget({ ...target, kind: 'Node' }, action));
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
          permissions={getDrainPermissions(drainTarget.clusterId)}
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
