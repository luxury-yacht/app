/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.test.tsx
 *
 * Test suite for ActionsMenu.
 * Covers key behaviors and edge cases for ActionsMenu.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionsMenu } from './ActionsMenu';
import type { ObjectActionData } from '@shared/hooks/useObjectActions';

// Spy-backed permission mock so tests can assert that getPermissionKey is
// called with the full GVK (regression: PR #139 made the backend reject
// queries without apiVersion, and CRD lookups in useObjectActions silently
// missed the permission map when group/version weren't threaded through).
const getPermissionKeySpy = vi.fn(
  (
    kind: string,
    verb: string,
    namespace?: string | null,
    subresource?: string | null,
    _clusterId?: string | null,
    group?: string | null,
    version?: string | null
  ) => `${group ?? ''}/${version ?? ''}|${kind}:${verb}:${namespace ?? ''}:${subresource ?? ''}`
);

vi.mock('@/core/capabilities', () => ({
  useUserPermissions: () => {
    // Return a map that grants all permissions by default
    const map = new Map();
    map.get = () => ({ allowed: true, pending: false });
    return map;
  },
  getPermissionKey: (...args: Parameters<typeof getPermissionKeySpy>) =>
    getPermissionKeySpy(...args),
}));

// Mock keyboard shortcuts for ConfirmationModal
vi.mock('@ui/shortcuts', () => ({
  useShortcut: vi.fn(),
  useKeyboardContext: () => ({
    pushContext: vi.fn(),
    popContext: vi.fn(),
  }),
  useKeyboardNavigationScope: vi.fn(),
}));

const openMenu = (container: HTMLElement) => {
  const trigger = container.querySelector<HTMLButtonElement>('.actions-menu-button');
  expect(trigger).toBeTruthy();
  act(() => {
    trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const makeObject = (kind: string, overrides?: Partial<ObjectActionData>): ObjectActionData => ({
  kind,
  name: 'test-resource',
  namespace: 'default',
  clusterId: 'cluster-1',
  ...overrides,
});

describe('ActionsMenu', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderMenu = async (props: React.ComponentProps<typeof ActionsMenu>) => {
    await act(async () => {
      root.render(<ActionsMenu {...props} />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    getPermissionKeySpy.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('does not render when object is null', async () => {
    await renderMenu({ object: null });
    expect(container.innerHTML).toBe('');
  });

  it('threads group/version into the delete permission lookup for CRDs', async () => {
    // Regression: PR #139 made permission keys include group/version. CRD
    // kinds aren't in the auto-resolve table, so the hook MUST forward
    // group/version on the descriptor or the lookup key won't match the
    // spec-emit key from queryKindPermissions and the Delete menu item
    // silently disappears for CRDs.
    await renderMenu({
      object: makeObject('DBInstance', {
        group: 'rds.services.k8s.aws',
        version: 'v1alpha1',
      }),
      onDelete: vi.fn(),
    });

    const deleteCalls = getPermissionKeySpy.mock.calls.filter(
      (call) => call[0] === 'DBInstance' && call[1] === 'delete'
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
    for (const call of deleteCalls) {
      // 6th and 7th positional args are group and version.
      expect(call[5]).toBe('rds.services.k8s.aws');
      expect(call[6]).toBe('v1alpha1');
    }

    // Sanity check: the Pod portforward lookup is hardcoded to core/v1
    // regardless of the surrounding object's GVK.
    const portForwardCalls = getPermissionKeySpy.mock.calls.filter(
      (call) => call[0] === 'Pod' && call[3] === 'portforward'
    );
    for (const call of portForwardCalls) {
      expect(call[5]).toBe('');
      expect(call[6]).toBe('v1');
    }
  });

  it('shows restart and delete actions for Deployment and invokes handlers', async () => {
    const onRestart = vi.fn();
    const onDelete = vi.fn();

    await renderMenu({
      object: makeObject('Deployment'),
      onRestart,
      onDelete,
    });

    openMenu(container);
    const items = Array.from(container.querySelectorAll<HTMLElement>('.context-menu-item'));
    expect(items.length).toBeGreaterThanOrEqual(2);

    // Find and click restart
    const restartItem = items.find((item) => item.textContent?.includes('Restart'));
    expect(restartItem).toBeTruthy();
    act(() => {
      restartItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRestart).toHaveBeenCalledTimes(1);

    // Reopen menu and click delete
    openMenu(container);
    const deleteItem = container.querySelector<HTMLElement>('.context-menu-item.danger');
    expect(deleteItem).toBeTruthy();
    act(() => {
      deleteItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('opens the scale modal, updates replicas, and applies the change', async () => {
    const onScale = vi.fn();

    await renderMenu({
      object: makeObject('Deployment'),
      currentReplicas: 3,
      onScale,
    });

    openMenu(container);
    const items = Array.from(container.querySelectorAll<HTMLElement>('.context-menu-item'));
    const scaleItem = items.find((item) => item.textContent?.includes('Scale'));
    expect(scaleItem).toBeTruthy();

    act(() => {
      scaleItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const modal = document.querySelector('.scale-modal');
    expect(modal).toBeTruthy();
    const input = modal?.querySelector<HTMLInputElement>('#scale-replicas');
    expect(input?.value).toBe('3');

    const plusButton = modal?.querySelectorAll<HTMLButtonElement>('.scale-spinner-btn')[1];
    act(() => {
      plusButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const onChange = (() => {
      if (!input) {
        return undefined;
      }
      const fiberKey = Object.keys(input).find((key) => key.startsWith('__reactFiber$'));
      return fiberKey ? (input as any)[fiberKey]?.memoizedProps?.onChange : undefined;
    })();
    expect(typeof onChange).toBe('function');

    await act(async () => {
      input!.value = '7';
      onChange?.({ target: { value: '7' } });
      await Promise.resolve();
    });

    const scaleButton = modal?.querySelector<HTMLButtonElement>('.button.warning');
    act(() => {
      scaleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onScale).toHaveBeenCalledWith(7);
  });

  it('closes the menu when clicking outside', async () => {
    await renderMenu({
      object: makeObject('Deployment'),
      onDelete: vi.fn(),
    });

    openMenu(container);
    expect(container.querySelector('.actions-menu-dropdown')).toBeTruthy();

    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(container.querySelector('.actions-menu-dropdown')).toBeNull();
  });

  it('shows port forward action for Pod', async () => {
    await renderMenu({
      object: makeObject('Pod'),
    });

    openMenu(container);
    const items = Array.from(container.querySelectorAll<HTMLElement>('.context-menu-item'));
    const portForwardItem = items.find((item) => item.textContent?.includes('Port Forward'));
    expect(portForwardItem).toBeTruthy();
  });

  describe('CronJob actions', () => {
    it('shows trigger and suspend actions for CronJob', async () => {
      const onTrigger = vi.fn();
      const onSuspendToggle = vi.fn();

      await renderMenu({
        object: makeObject('CronJob'),
        onTrigger,
        onSuspendToggle,
      });

      openMenu(container);
      const items = Array.from(container.querySelectorAll<HTMLElement>('.context-menu-item'));

      const triggerItem = items.find((item) => item.textContent?.includes('Trigger Now'));
      const suspendItem = items.find((item) => item.textContent?.includes('Suspend'));

      expect(triggerItem).toBeTruthy();
      expect(suspendItem).toBeTruthy();
    });

    it('shows Resume instead of Suspend when status is Suspended', async () => {
      await renderMenu({
        object: makeObject('CronJob', { status: 'Suspended' }),
        onSuspendToggle: vi.fn(),
      });

      openMenu(container);
      const items = Array.from(container.querySelectorAll<HTMLElement>('.context-menu-item'));

      const resumeItem = items.find((item) => item.textContent?.includes('Resume'));
      const suspendItem = items.find((item) => item.textContent?.includes('Suspend'));

      expect(resumeItem).toBeTruthy();
      expect(suspendItem).toBeFalsy();
    });

    it('disables trigger when CronJob is suspended', async () => {
      await renderMenu({
        object: makeObject('CronJob', { status: 'Suspended' }),
        onTrigger: vi.fn(),
      });

      openMenu(container);
      const items = Array.from(container.querySelectorAll<HTMLElement>('.context-menu-item'));
      const triggerItem = items.find((item) => item.textContent?.includes('Trigger Now'));
      expect(triggerItem?.classList.contains('disabled')).toBe(true);
    });

    it('calls onSuspendToggle when suspend is clicked', async () => {
      const onSuspendToggle = vi.fn();

      await renderMenu({
        object: makeObject('CronJob'),
        onSuspendToggle,
      });

      openMenu(container);
      const items = Array.from(container.querySelectorAll<HTMLElement>('.context-menu-item'));
      const suspendItem = items.find((item) => item.textContent?.includes('Suspend'));

      act(() => {
        suspendItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onSuspendToggle).toHaveBeenCalledTimes(1);
    });

    it('shows trigger confirmation modal and calls onTrigger when confirmed', async () => {
      const onTrigger = vi.fn();

      await renderMenu({
        object: makeObject('CronJob'),
        onTrigger,
      });

      openMenu(container);
      const items = Array.from(container.querySelectorAll<HTMLElement>('.context-menu-item'));
      const triggerItem = items.find((item) => item.textContent?.includes('Trigger Now'));

      act(() => {
        triggerItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      // Modal is portaled to document.body, not the container
      const modal = document.querySelector('.modal-container');
      expect(modal).toBeTruthy();

      // Click confirm
      const confirmBtn = modal?.querySelector<HTMLButtonElement>('.button:not(.cancel)');
      act(() => {
        confirmBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onTrigger).toHaveBeenCalledTimes(1);
    });
  });
});
