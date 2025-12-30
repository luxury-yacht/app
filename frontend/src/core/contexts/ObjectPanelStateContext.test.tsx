/**
 * frontend/src/core/contexts/ObjectPanelStateContext.test.tsx
 *
 * Test suite for ObjectPanelStateContext.
 * Ensures object panel state is scoped per cluster tab.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectPanelStateProvider, useObjectPanelState } from './ObjectPanelStateContext';

let mockClusterId = 'cluster-a';
let mockClusterIds = ['cluster-a', 'cluster-b'];

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: mockClusterId,
    selectedClusterIds: mockClusterIds,
  }),
}));

const stateRef: { current: ReturnType<typeof useObjectPanelState> | null } = { current: null };

const Harness: React.FC = () => {
  stateRef.current = useObjectPanelState();
  return null;
};

describe('ObjectPanelStateContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mockClusterId = 'cluster-a';
    mockClusterIds = ['cluster-a', 'cluster-b'];
    stateRef.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderProvider = async () => {
    await act(async () => {
      root.render(
        <ObjectPanelStateProvider>
          <Harness />
        </ObjectPanelStateProvider>
      );
    });
  };

  it('keeps object panel state isolated per cluster tab', async () => {
    await renderProvider();

    act(() => {
      stateRef.current?.onRowClick({ kind: 'Pod', name: 'api', namespace: 'default' });
    });
    expect(stateRef.current?.showObjectPanel).toBe(true);
    expect(stateRef.current?.selectedObject?.name).toBe('api');

    mockClusterId = 'cluster-b';
    await renderProvider();
    expect(stateRef.current?.showObjectPanel).toBe(false);
    expect(stateRef.current?.selectedObject).toBeNull();

    act(() => {
      stateRef.current?.onRowClick({ kind: 'Deployment', name: 'web', namespace: 'default' });
    });
    expect(stateRef.current?.selectedObject?.name).toBe('web');

    mockClusterId = 'cluster-a';
    await renderProvider();
    expect(stateRef.current?.showObjectPanel).toBe(true);
    expect(stateRef.current?.selectedObject?.name).toBe('api');
  });

  it('clears object panel state when a tab is closed', async () => {
    mockClusterId = 'cluster-b';
    await renderProvider();

    act(() => {
      stateRef.current?.onRowClick({ kind: 'Pod', name: 'job', namespace: 'default' });
    });
    expect(stateRef.current?.showObjectPanel).toBe(true);

    mockClusterIds = ['cluster-a'];
    mockClusterId = 'cluster-a';
    await renderProvider();

    mockClusterIds = ['cluster-a', 'cluster-b'];
    mockClusterId = 'cluster-b';
    await renderProvider();

    expect(stateRef.current?.showObjectPanel).toBe(false);
    expect(stateRef.current?.selectedObject).toBeNull();
  });
});
