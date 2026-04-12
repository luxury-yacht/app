/**
 * frontend/src/components/modals/ObjectDiffModal.test.tsx
 *
 * Test suite for ObjectDiffModal.
 * Covers basic modal behavior and shortcut handling.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ObjectDiffModal from './ObjectDiffModal';
import { KeyboardProvider } from '@ui/shortcuts';

const refreshMocks = vi.hoisted(() => ({
  useRefreshScopedDomain: vi.fn(),
  refreshOrchestrator: {
    setScopedDomainEnabled: vi.fn(),
    resetScopedDomain: vi.fn(),
    fetchScopedDomain: vi.fn(),
  },
}));

const kubeconfigMocks = vi.hoisted(() => ({
  selectedClusterId: 'cluster-a',
  selectedKubeconfigs: ['kubeconfig-a'],
  getClusterMeta: () => ({ id: 'cluster-a', name: 'Cluster A' }),
}));

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

vi.mock('@core/refresh', () => ({
  useRefreshScopedDomain: (...args: unknown[]) => refreshMocks.useRefreshScopedDomain(...args),
  refreshOrchestrator: refreshMocks.refreshOrchestrator,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => kubeconfigMocks,
}));

describe('ObjectDiffModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(async () => {
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
    refreshMocks.useRefreshScopedDomain.mockImplementation(() => ({
      status: 'idle',
      data: null,
      stats: null,
      error: null,
      droppedAutoRefreshes: 0,
      scope: undefined,
    }));

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal isOpen onClose={vi.fn()} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('closes via overlay click but ignores clicks inside modal', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });

    const overlay = document.querySelector('.object-diff-modal-overlay') as HTMLDivElement | null;
    expect(overlay).toBeTruthy();
    const modal = document.querySelector('.object-diff-modal') as HTMLDivElement | null;
    expect(modal).toBeTruthy();

    act(() => {
      modal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape through the shared modal surface', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjectDiffModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalled();
  });
});
