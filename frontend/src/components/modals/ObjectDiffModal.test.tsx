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

const shortcutMocks = vi.hoisted(() => ({
  useShortcut: vi.fn(),
  useKeyboardNavigationScope: vi.fn(),
}));

const contextMocks = vi.hoisted(() => ({
  pushContext: vi.fn(),
  popContext: vi.fn(),
}));

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

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => shortcutMocks.useShortcut(...args),
  useKeyboardContext: () => contextMocks,
  useKeyboardNavigationScope: (...args: unknown[]) =>
    shortcutMocks.useKeyboardNavigationScope(...args),
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
    shortcutMocks.useShortcut.mockClear();
    contextMocks.pushContext.mockClear();
    contextMocks.popContext.mockClear();
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
      root.render(<ObjectDiffModal isOpen onClose={vi.fn()} />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const getEscapeShortcut = () => {
    for (let i = shortcutMocks.useShortcut.mock.calls.length - 1; i >= 0; i -= 1) {
      const config = shortcutMocks.useShortcut.mock.calls[i][0] as {
        key: string;
        handler: () => boolean;
        enabled?: boolean;
      };
      if (config.key === 'Escape') {
        return config;
      }
    }
    throw new Error('Escape shortcut not registered');
  };

  it('closes via overlay click but ignores clicks inside modal', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<ObjectDiffModal isOpen onClose={onClose} />);
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

  it('invokes onClose when Escape shortcut handler fires', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(<ObjectDiffModal isOpen onClose={onClose} />);
    });

    const escapeShortcut = getEscapeShortcut();
    expect(escapeShortcut.enabled).toBe(true);

    let result = false;
    act(() => {
      result = escapeShortcut.handler();
    });
    expect(result).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });
});
