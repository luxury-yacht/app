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

const openMenu = (container: HTMLElement) => {
  const trigger = container.querySelector<HTMLButtonElement>('.actions-menu-button');
  expect(trigger).toBeTruthy();
  act(() => {
    trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

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

  it('does not render when no actions are available', async () => {
    await renderMenu({});
    expect(container.innerHTML).toBe('');
  });

  it('shows restart and delete actions and invokes handlers', async () => {
    const onRestart = vi.fn();
    const onDelete = vi.fn();

    await renderMenu({
      canRestart: true,
      canDelete: true,
      onRestart,
      onDelete,
      actionLoading: false,
      deleteLoading: false,
    });

    openMenu(container);
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-item'));
    expect(items.length).toBeGreaterThanOrEqual(2);

    act(() => {
      items[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRestart).toHaveBeenCalledTimes(1);

    openMenu(container);
    const deleteItem = container.querySelector<HTMLButtonElement>('.context-menu-item.danger');
    expect(deleteItem).toBeTruthy();
    act(() => {
      deleteItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('displays disabled reasons when actions are unavailable', async () => {
    await renderMenu({
      restartDisabledReason: 'Needs permissions',
      scaleDisabledReason: 'Not scalable',
      deleteDisabledReason: 'Protected',
    });

    openMenu(container);
    const reasons = Array.from(container.querySelectorAll('.context-menu-reason')).map((el) =>
      el.textContent?.trim()
    );
    expect(reasons).toEqual(['Needs permissions', 'Not scalable', 'Protected']);
  });

  it('opens the scale modal, updates replicas, and applies the change', async () => {
    const onScale = vi.fn();

    await renderMenu({
      canScale: true,
      currentReplicas: 3,
      onScale,
    });

    openMenu(container);
    const scaleItem = container.querySelector<HTMLButtonElement>('.context-menu-item:not(.danger)');
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
    await renderMenu({ canDelete: true });

    openMenu(container);
    expect(container.querySelector('.actions-menu-dropdown')).toBeTruthy();

    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(container.querySelector('.actions-menu-dropdown')).toBeNull();
  });

  describe('CronJob actions', () => {
    it('shows trigger and suspend actions for CronJob', async () => {
      const onTrigger = vi.fn();
      const onSuspendToggle = vi.fn();

      await renderMenu({
        canTrigger: true,
        canSuspend: true,
        isSuspended: false,
        onTrigger,
        onSuspendToggle,
      });

      openMenu(container);
      const items = Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-item'));

      const triggerItem = items.find((item) => item.textContent?.includes('Trigger Now'));
      const suspendItem = items.find((item) => item.textContent?.includes('Suspend'));

      expect(triggerItem).toBeTruthy();
      expect(suspendItem).toBeTruthy();
    });

    it('shows Resume instead of Suspend when isSuspended is true', async () => {
      await renderMenu({
        canTrigger: true,
        canSuspend: true,
        isSuspended: true,
      });

      openMenu(container);
      const items = Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-item'));

      const resumeItem = items.find((item) => item.textContent?.includes('Resume'));
      const suspendItem = items.find((item) => item.textContent?.includes('Suspend'));

      expect(resumeItem).toBeTruthy();
      expect(suspendItem).toBeFalsy();
    });

    it('disables trigger when CronJob is suspended', async () => {
      await renderMenu({
        canTrigger: true,
        canSuspend: true,
        isSuspended: true,
      });

      openMenu(container);
      const triggerItem = container.querySelector<HTMLElement>(
        '.context-menu-item:first-child'
      );
      expect(triggerItem?.classList.contains('disabled')).toBe(true);
    });

    it('calls onSuspendToggle when suspend is clicked', async () => {
      const onSuspendToggle = vi.fn();

      await renderMenu({
        canSuspend: true,
        isSuspended: false,
        onSuspendToggle,
      });

      openMenu(container);
      const items = Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-item'));
      const suspendItem = items.find((item) => item.textContent?.includes('Suspend'));

      act(() => {
        suspendItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onSuspendToggle).toHaveBeenCalledTimes(1);
    });

    it('shows trigger confirmation modal and calls onTrigger when confirmed', async () => {
      const onTrigger = vi.fn();

      await renderMenu({
        canTrigger: true,
        isSuspended: false,
        onTrigger,
      });

      openMenu(container);
      const items = Array.from(container.querySelectorAll<HTMLButtonElement>('.context-menu-item'));
      const triggerItem = items.find((item) => item.textContent?.includes('Trigger Now'));

      act(() => {
        triggerItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      // Modal should be visible
      const modal = container.querySelector('.modal-container');
      expect(modal).toBeTruthy();

      // Click confirm
      const confirmBtn = modal?.querySelector<HTMLButtonElement>('.button.primary');
      act(() => {
        confirmBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(onTrigger).toHaveBeenCalledTimes(1);
    });
  });
});
