/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.integration.test.tsx
 *
 * Integration coverage for the permission pipeline behind the object-panel
 * actions menu: the REAL permission store (only the QueryPermissions RPC is
 * mocked) feeding the real ActionsMenu. Pins the spec-emit ↔ lookup key
 * agreement for pod actions — the contract behind "pod Details menu is
 * missing Port Forward / Delete" regressions.
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/capabilities/permissionRead', () => ({
  queryPermissions: vi.fn(async (queries: Array<Record<string, unknown>>) => ({
    results: queries.map((query) => ({
      ...query,
      allowed: true,
      source: 'ssrr',
      reason: '',
      error: '',
    })),
    diagnostics: [],
  })),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: vi.fn(),
  useKeyboardSurface: vi.fn(),
  useKeyboardContext: () => ({
    registerShortcut: vi.fn(),
    unregisterShortcut: vi.fn(),
    getAvailableShortcuts: vi.fn(() => []),
    isShortcutAvailable: vi.fn(() => false),
    setEnabled: vi.fn(),
    isEnabled: true,
    registerSurface: vi.fn(),
    unregisterSurface: vi.fn(),
    updateSurface: vi.fn(),
    dispatchNativeAction: vi.fn(() => false),
    hasActiveBlockingSurface: vi.fn(() => false),
  }),
}));

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import { queryNamespacePermissions } from '@/core/capabilities';
import { __resetForTests } from '@/core/capabilities/permissionStore';
import { ActionsMenu } from './ActionsMenu';

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

describe('ActionsMenu + real permission store', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    __resetForTests();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    __resetForTests();
  });

  it('shows Port Forward and Delete for a pod once namespace permissions load', async () => {
    // Same call ObjectPanel.tsx makes on mount for a pod panel.
    queryNamespacePermissions('team-a', 'cluster-1');
    await flush();

    // actionObject exactly as Details/Overview/index.tsx builds it for a pod.
    const actionObject = {
      kind: 'Pod',
      name: 'api-123',
      namespace: 'team-a',
      clusterId: 'cluster-1',
      clusterName: 'ctx-1',
      version: 'v1',
      status: 'Running',
      ready: '1/1',
      desiredReplicas: 0,
      hpaManaged: false,
    };

    await act(async () => {
      root.render(
        <ZoomProvider>
          <ActionsMenu object={actionObject} />
        </ZoomProvider>
      );
      await Promise.resolve();
    });
    await flush();

    const trigger = container.querySelector<HTMLButtonElement>('.actions-menu-button');
    expect(trigger).toBeTruthy();
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.context-menu-item'));
    const portForwardItem = items.find(
      (item) => item.dataset.contextActionId === OBJECT_ACTION_IDS.portForward
    );
    const deleteItem = items.find(
      (item) => item.dataset.contextActionId === OBJECT_ACTION_IDS.delete
    );

    expect(portForwardItem).toBeTruthy();
    expect(portForwardItem?.className).not.toContain('disabled');
    expect(deleteItem).toBeTruthy();
  });
});
