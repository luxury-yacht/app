/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelActions.ts
 *
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
  showRollbackModal: () => void;
  hideRollbackModal: () => void;
}

const getWorkloadKind = (
  objectKind: string | null,
  objectData: PanelObjectData | null
): string | null => {
  // PanelObjectData.kind is the original-case Kind from the data source,
  // so it's preferred whenever present. The previous fallback through
  // WORKLOAD_KIND_API_NAMES existed only as a casing safety net for the
  // (now defunct) lowercase callers; that map is retired.
  if (objectData?.kind) {
    return objectData.kind;
  }
  return objectKind;
};

export const useObjectPanelActions = ({
  objectData,
  objectKind,
  state,
  dispatch,
  close,
  fetchResourceDetails,
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

  const showRollbackModal = useCallback(() => {
    dispatch({ type: 'SHOW_ROLLBACK_MODAL', payload: true });
  }, [dispatch]);

  const hideRollbackModal = useCallback(() => {
    dispatch({ type: 'SHOW_ROLLBACK_MODAL', payload: false });
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
      // Multi-cluster rule (see AGENTS.md): every backend command must
      // carry a resolved clusterId. Fail loud here rather than letting
      // an empty string fall through to the Wails layer, which would
      // surface as "cluster not found" at the backend resolver.
      const clusterId = objectData.clusterId;
      if (!clusterId) {
        dispatch({
          type: 'SET_ACTION_ERROR',
          payload: `Cannot perform ${action} on ${name}: clusterId is missing`,
        });
        dispatch({ type: 'SET_ACTION_LOADING', payload: false });
        return;
      }

      try {
        switch (action) {
          case 'restart': {
            if (
              objectKind === 'deployment' ||
              objectKind === 'daemonset' ||
              objectKind === 'statefulset'
            ) {
              const workloadKind = getWorkloadKind(objectKind, objectData);
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
              // PanelObjectData always carries a version after the
              // kind-only-objects fix — every entry point (BrowseView,
              // NsView*/ClusterView*, CommandPalette, EventsTab,
              // resolveBuiltinGroupVersion) populates group/version. A
              // missing version here is a programming bug; fail loud
              // rather than fall back to the retired kind-only resolver.
              // See  step 5.
              if (!objectData.version) {
                throw new Error(
                  `Cannot delete ${resourceKind}/${name}: apiVersion missing on PanelObjectData`
                );
              }
              const apiVersion = objectData.group
                ? `${objectData.group}/${objectData.version}`
                : objectData.version;
              await app.DeleteResourceByGVK(clusterId, apiVersion, resourceKind, namespace, name);
            }
            dispatch({ type: 'SET_RESOURCE_DELETED', payload: { deleted: true, name } });
            close();
            break;
          }
          case 'scale': {
            if (objectKind === 'deployment' || objectKind === 'statefulset') {
              const replicas = scaleOverride ?? state.scaleReplicas;
              const workloadKind = getWorkloadKind(objectKind, objectData);
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
    showRollbackModal,
    hideRollbackModal,
  };
};
