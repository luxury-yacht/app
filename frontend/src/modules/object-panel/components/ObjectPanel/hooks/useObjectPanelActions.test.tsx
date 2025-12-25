/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelActions.test.tsx
 *
 * Test suite for useObjectPanelActions.
 * Covers key behaviors and edge cases for useObjectPanelActions.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useObjectPanelActions } from './useObjectPanelActions';
import type { PanelState, PanelObjectData } from '../types';
import { WORKLOAD_KIND_API_NAMES } from '../constants';

const restartMock = vi.fn();
const deletePodMock = vi.fn();
const deleteHelmMock = vi.fn();
const deleteResourceMock = vi.fn();
const scaleMock = vi.fn();
const errorHandlerMock = vi.fn();

vi.mock('@wailsjs/go/backend/App', () => ({
  RestartWorkload: (...args: unknown[]) => restartMock(...args),
  DeletePod: (...args: unknown[]) => deletePodMock(...args),
  DeleteHelmRelease: (...args: unknown[]) => deleteHelmMock(...args),
  DeleteResource: (...args: unknown[]) => deleteResourceMock(...args),
  ScaleWorkload: (...args: unknown[]) => scaleMock(...args),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: { handle: (...args: unknown[]) => errorHandlerMock(...args) },
}));

describe('useObjectPanelActions', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: ReturnType<typeof useObjectPanelActions> | null } = { current: null };
  const dispatchMock = vi.fn();
  const closeMock = vi.fn();
  const fetchDetailsMock = vi.fn();

  const baseState = (): PanelState => ({
    activeTab: 'details',
    actionLoading: false,
    actionError: null,
    scaleReplicas: 3,
    showScaleInput: false,
    showRestartConfirm: false,
    showDeleteConfirm: false,
    resourceDeleted: false,
    deletedResourceName: '',
  });

  const objectData: PanelObjectData = {
    kind: 'Deployment',
    name: 'api',
    namespace: 'team-a',
  };

  const renderHook = async (
    override: Partial<Parameters<typeof useObjectPanelActions>[0]> = {}
  ) => {
    const propsRef = {
      current: {
        objectData,
        objectKind: 'deployment',
        state: baseState(),
        dispatch: dispatchMock,
        close: closeMock,
        fetchResourceDetails: fetchDetailsMock,
        workloadKindApiNames: WORKLOAD_KIND_API_NAMES,
        ...override,
      },
    };

    const HookHarness: React.FC = () => {
      resultRef.current = useObjectPanelActions(propsRef.current);
      return null;
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    return {
      getResult: () => resultRef.current!,
      rerender: async (next?: Partial<Parameters<typeof useObjectPanelActions>[0]>) => {
        propsRef.current = { ...propsRef.current, ...next };
        await act(async () => {
          root.render(<HookHarness />);
          await Promise.resolve();
        });
      },
    };
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resultRef.current = null;
    dispatchMock.mockClear();
    closeMock.mockClear();
    fetchDetailsMock.mockClear();
    restartMock.mockReset();
    deletePodMock.mockReset();
    deleteHelmMock.mockReset();
    deleteResourceMock.mockReset();
    scaleMock.mockReset();
    errorHandlerMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('handles workload restart and closes confirmation modal', async () => {
    const { getResult } = await renderHook();
    const actions = getResult();

    await actions.handleAction('restart', 'showRestartConfirm');

    expect(dispatchMock).toHaveBeenNthCalledWith(1, {
      type: 'SHOW_RESTART_CONFIRM',
      payload: false,
    });
    expect(dispatchMock).toHaveBeenNthCalledWith(2, {
      type: 'SET_ACTION_LOADING',
      payload: true,
    });
    expect(dispatchMock).toHaveBeenNthCalledWith(3, {
      type: 'SET_ACTION_ERROR',
      payload: null,
    });
    expect(restartMock).toHaveBeenCalledWith('team-a', 'api', 'Deployment');
    expect(dispatchMock).toHaveBeenLastCalledWith({
      type: 'SET_ACTION_LOADING',
      payload: false,
    });
    expect(errorHandlerMock).not.toHaveBeenCalled();
  });

  it('deletes pods and closes the panel', async () => {
    const deleteState = baseState();
    const { getResult } = await renderHook({
      objectData: { kind: 'Pod', name: 'api-0', namespace: 'team-a' },
      objectKind: 'pod',
      state: deleteState,
    });

    const actions = getResult();
    await actions.handleAction('delete', 'showDeleteConfirm');

    expect(deletePodMock).toHaveBeenCalledWith('team-a', 'api-0');
    expect(closeMock).toHaveBeenCalled();
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'SET_RESOURCE_DELETED',
      payload: { deleted: true, name: 'api-0' },
    });
  });

  it('scales workloads, hides the scale input, and refreshes details', async () => {
    const state = baseState();
    state.scaleReplicas = 2;
    const { getResult, rerender } = await renderHook({ state });
    const actions = getResult();

    await actions.handleAction('scale');

    expect(scaleMock).toHaveBeenCalledWith('team-a', 'api', 'Deployment', 2);
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'SHOW_SCALE_INPUT', payload: false });
    expect(fetchDetailsMock).toHaveBeenCalledWith(true);

    dispatchMock.mockClear();
    // Simulate rerender with updated replicas
    await rerender({ state: { ...state, scaleReplicas: 5 } });
    const updatedActions = resultRef.current!;
    await updatedActions.handleAction('scale', undefined, 5);

    expect(scaleMock).toHaveBeenLastCalledWith('team-a', 'api', 'Deployment', 5);
  });

  it('exposes helpers to manipulate confirmation and scale state', async () => {
    const { getResult } = await renderHook();
    const actions = getResult();

    actions.showRestartConfirm();
    actions.showDeleteConfirm();
    actions.showScaleInput(4);
    actions.setScaleReplicas(3);
    actions.hideRestartConfirm();
    actions.hideDeleteConfirm();
    actions.hideScaleInput();

    expect(dispatchMock).toHaveBeenNthCalledWith(1, {
      type: 'SHOW_RESTART_CONFIRM',
      payload: true,
    });
    expect(dispatchMock).toHaveBeenNthCalledWith(2, {
      type: 'SHOW_DELETE_CONFIRM',
      payload: true,
    });
    expect(dispatchMock).toHaveBeenNthCalledWith(3, {
      type: 'SET_SCALE_REPLICAS',
      payload: 4,
    });
    expect(dispatchMock).toHaveBeenNthCalledWith(4, {
      type: 'SHOW_SCALE_INPUT',
      payload: true,
    });
    expect(dispatchMock).toHaveBeenNthCalledWith(5, {
      type: 'SET_SCALE_REPLICAS',
      payload: 3,
    });
    expect(dispatchMock).toHaveBeenNthCalledWith(6, {
      type: 'SHOW_RESTART_CONFIRM',
      payload: false,
    });
    expect(dispatchMock).toHaveBeenNthCalledWith(7, {
      type: 'SHOW_DELETE_CONFIRM',
      payload: false,
    });
    expect(dispatchMock).toHaveBeenNthCalledWith(8, {
      type: 'SHOW_SCALE_INPUT',
      payload: false,
    });
  });
});
