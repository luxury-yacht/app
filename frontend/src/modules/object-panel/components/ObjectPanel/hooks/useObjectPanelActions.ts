/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelActions.ts
 *
 * Hook for useObjectPanelActions.
 * Manages actions related to the object panel such as restart, delete, and scale.
 * Handles state updates and API calls for resource actions.
 */
import { useCallback, type Dispatch } from 'react';

import * as app from '@wailsjs/go/backend/App';
import { errorHandler } from '@utils/errorHandler';

import type { PanelAction, PanelObjectData, PanelState, ResourceAction } from '../types';

interface UseObjectPanelActionsArgs {
  objectData: PanelObjectData | null;
  objectKind: string | null;
  state: PanelState;
  dispatch: Dispatch<PanelAction>;
  close: () => void;
  fetchResourceDetails: (isManualRefresh?: boolean) => Promise<void>;
  workloadKindApiNames: Record<string, string>;
}

interface ObjectPanelActions {
  handleAction: (
    action: ResourceAction,
    confirmModalType?: 'showRestartConfirm' | 'showDeleteConfirm',
    scaleOverride?: number
  ) => Promise<void>;
  setScaleReplicas: (value: number) => void;
  showScaleInput: (replicas?: number) => void;
  hideScaleInput: () => void;
  showRestartConfirm: () => void;
  hideRestartConfirm: () => void;
  showDeleteConfirm: () => void;
  hideDeleteConfirm: () => void;
}

const getWorkloadKind = (
  objectKind: string | null,
  objectData: PanelObjectData | null,
  workloadKindApiNames: Record<string, string>
): string | null => {
  if (!objectKind) {
    return objectData?.kind ?? null;
  }
  if (objectData?.kind) {
    return objectData.kind;
  }
  return workloadKindApiNames[objectKind] ?? objectKind;
};

export const useObjectPanelActions = ({
  objectData,
  objectKind,
  state,
  dispatch,
  close,
  fetchResourceDetails,
  workloadKindApiNames,
}: UseObjectPanelActionsArgs): ObjectPanelActions => {
  const setScaleReplicas = useCallback(
    (value: number) => {
      dispatch({ type: 'SET_SCALE_REPLICAS', payload: value });
    },
    [dispatch]
  );

  const showScaleInput = useCallback(
    (replicas?: number) => {
      if (replicas !== undefined) {
        dispatch({ type: 'SET_SCALE_REPLICAS', payload: replicas });
      }
      dispatch({ type: 'SHOW_SCALE_INPUT', payload: true });
    },
    [dispatch]
  );

  const hideScaleInput = useCallback(() => {
    dispatch({ type: 'SHOW_SCALE_INPUT', payload: false });
  }, [dispatch]);

  const showRestartConfirm = useCallback(() => {
    dispatch({ type: 'SHOW_RESTART_CONFIRM', payload: true });
  }, [dispatch]);

  const hideRestartConfirm = useCallback(() => {
    dispatch({ type: 'SHOW_RESTART_CONFIRM', payload: false });
  }, [dispatch]);

  const showDeleteConfirm = useCallback(() => {
    dispatch({ type: 'SHOW_DELETE_CONFIRM', payload: true });
  }, [dispatch]);

  const hideDeleteConfirm = useCallback(() => {
    dispatch({ type: 'SHOW_DELETE_CONFIRM', payload: false });
  }, [dispatch]);

  const handleAction = useCallback(
    async (
      action: ResourceAction,
      confirmModalType?: 'showRestartConfirm' | 'showDeleteConfirm',
      scaleOverride?: number
    ) => {
      if (!objectData || !objectKind) {
        return;
      }

      if (confirmModalType === 'showRestartConfirm') {
        hideRestartConfirm();
      } else if (confirmModalType === 'showDeleteConfirm') {
        hideDeleteConfirm();
      }

      dispatch({ type: 'SET_ACTION_LOADING', payload: true });
      dispatch({ type: 'SET_ACTION_ERROR', payload: null });

      const namespace = objectData.namespace || '';
      const name = objectData.name || '';
      const clusterId = objectData.clusterId ?? '';

      try {
        switch (action) {
          case 'restart': {
            if (
              objectKind === 'deployment' ||
              objectKind === 'daemonset' ||
              objectKind === 'statefulset'
            ) {
              const workloadKind = getWorkloadKind(objectKind, objectData, workloadKindApiNames);
              if (!workloadKind) {
                throw new Error(
                  `Unsupported workload kind for restart: ${objectKind ?? 'unknown'}`
                );
              }
              await app.RestartWorkload(clusterId, namespace, name, workloadKind);
            }
            break;
          }
          case 'delete': {
            if (objectKind === 'pod') {
              await app.DeletePod(clusterId, namespace, name);
            } else if (objectKind === 'helmrelease') {
              await app.DeleteHelmRelease(clusterId, namespace, name);
            } else {
              const resourceKind = objectData.kind || objectKind;
              await app.DeleteResource(clusterId, resourceKind, namespace, name);
            }
            dispatch({ type: 'SET_RESOURCE_DELETED', payload: { deleted: true, name } });
            close();
            break;
          }
          case 'scale': {
            if (objectKind === 'deployment' || objectKind === 'statefulset') {
              const replicas = scaleOverride ?? state.scaleReplicas;
              const workloadKind = getWorkloadKind(objectKind, objectData, workloadKindApiNames);
              if (!workloadKind) {
                throw new Error(`Unsupported workload kind for scale: ${objectKind ?? 'unknown'}`);
              }
              await app.ScaleWorkload(clusterId, namespace, name, workloadKind, replicas);
            }
            hideScaleInput();
            await fetchResourceDetails(true);
            break;
          }
          default:
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to ${action} resource`;
        dispatch({ type: 'SET_ACTION_ERROR', payload: message });
        errorHandler.handle(error, { action: `${action}Resource` });
      } finally {
        dispatch({ type: 'SET_ACTION_LOADING', payload: false });
      }
    },
    [
      objectData,
      objectKind,
      dispatch,
      hideDeleteConfirm,
      hideRestartConfirm,
      hideScaleInput,
      close,
      fetchResourceDetails,
      state.scaleReplicas,
      workloadKindApiNames,
    ]
  );

  return {
    handleAction,
    setScaleReplicas,
    showScaleInput,
    hideScaleInput,
    showRestartConfirm,
    hideRestartConfirm,
    showDeleteConfirm,
    hideDeleteConfirm,
  };
};
