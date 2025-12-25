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
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>('.actions-menu-item'));
    expect(items.length).toBeGreaterThanOrEqual(2);

    act(() => {
      items[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRestart).toHaveBeenCalledTimes(1);

    openMenu(container);
    const deleteItem = container.querySelector<HTMLButtonElement>('.actions-menu-item.danger');
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
    const reasons = Array.from(container.querySelectorAll('.actions-menu-reason')).map((el) =>
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
    const scaleItem = container.querySelector<HTMLButtonElement>('.actions-menu-item:not(.danger)');
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
});
