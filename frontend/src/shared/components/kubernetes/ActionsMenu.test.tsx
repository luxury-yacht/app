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

// Mock the capabilities hook to control permissions in tests
vi.mock('@/core/capabilities', () => ({
  useUserPermissions: () => {
    // Return a map that grants all permissions by default
    const map = new Map();
    map.get = () => ({ allowed: true, pending: false });
    return map;
  },
  getPermissionKey: (kind: string, verb: string, namespace?: string, subresource?: string) =>
    `${kind}:${verb}:${namespace || ''}:${subresource || ''}`,
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

    const modal = container.querySelector('.scale-modal');
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
