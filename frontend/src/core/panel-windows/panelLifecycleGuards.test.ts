import * as React from 'react';
import { act } from 'react';
import { createPortal } from 'react-dom';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import { subscribeToErrors } from '@/utils/errorHandler';
import {
  PanelLifecycleGuardProvider,
  PanelLifecycleGuardRegistry,
  useOptionalPanelLifecycleGuardRegistry,
  usePanelLifecycleGuard,
  usePanelLifecycleGuardRegistry,
} from './panelLifecycleGuards';

describe('PanelLifecycleGuardRegistry', () => {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
  });

  async function renderTransferSurface() {
    vi.useFakeTimers();
    const captured: { registry: PanelLifecycleGuardRegistry | null } = { registry: null };
    const edit = vi.fn();
    const Probe = () => {
      captured.registry = usePanelLifecycleGuardRegistry();
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('button', { type: 'button', onClick: edit }, 'Panel content'),
        createPortal(
          React.createElement('button', { type: 'button', onClick: edit }, 'Portal action'),
          document.body
        )
      );
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    await act(async () => {
      root?.render(
        React.createElement(PanelLifecycleGuardProvider, null, React.createElement(Probe))
      );
    });
    return {
      registry: requireValue(captured.registry, 'Transfer guard must be mounted'),
      surface: requireValue(
        container.querySelector<HTMLElement>('.panel-lifecycle-surface'),
        'Panel content must be mounted'
      ),
      edit,
    };
  }

  it('guards content immediately without showing status for a quick transfer', async () => {
    const { registry, surface, edit } = await renderTransferSurface();
    const panel = requireValue(surface.querySelector('button'), 'Panel button must exist');
    const portal = requireValue(document.body.lastElementChild, 'Portal button must exist');
    act(() => registry.freeze('quick-move', ['panel-a']));
    expect(surface.inert).toBe(true);
    expect(panel.textContent).toBe('Panel content');
    panel.click();
    portal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(edit).not.toHaveBeenCalled();
    expect(container?.querySelector('output')).toBeNull();

    act(() => vi.advanceTimersByTime(499));
    expect(container?.querySelector('output')).toBeNull();
    act(() => registry.releaseTransfer('quick-move'));
    act(() => vi.advanceTimersByTime(1000));
    expect(container?.querySelector('output')).toBeNull();
    expect(surface.inert).toBe(false);
    expect(surface.querySelector('button')).toBe(panel);
    panel.click();
    expect(edit).toHaveBeenCalledOnce();
  });

  it('shows delayed status until the last overlapping transfer settles', async () => {
    const { registry, surface } = await renderTransferSurface();
    act(() => registry.freeze('move-a', ['panel-a']));
    act(() => vi.advanceTimersByTime(500));
    expect(container?.querySelector('output')?.textContent).toBe('Moving panels…');
    expect(surface.inert).toBe(true);

    act(() => registry.freeze('move-b', ['panel-b']));
    act(() => registry.releaseTransfer('move-a'));
    expect(container?.querySelector('output')?.textContent).toBe('Moving panels…');
    expect(surface.inert).toBe(true);
    act(() => registry.releaseTransfer('move-b'));
    expect(container?.querySelector('output')).toBeNull();
    expect(surface.inert).toBe(false);

    act(() => registry.freeze('move-c', ['panel-c']));
    expect(container?.querySelector('output')).toBeNull();
    act(() => vi.advanceTimersByTime(499));
    expect(container?.querySelector('output')).toBeNull();
  });

  it('cancels delayed status when its renderer unmounts', async () => {
    const { registry } = await renderTransferSurface();
    act(() => registry.freeze('move-a', ['panel-a']));
    await act(async () => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns and focuses the first blocker in requested tab order', () => {
    const registry = new PanelLifecycleGuardRegistry();
    const focusA = vi.fn();
    const focusB = vi.fn();
    registry.register('panel-a', () => ({ reason: 'unsaved-yaml', focus: focusA }));
    registry.register('panel-b', () => ({ reason: 'mutation-in-flight', focus: focusB }));

    const blocker = registry.firstBlocker(['panel-b', 'panel-a']);
    blocker?.focus();

    expect(blocker?.reason).toBe('mutation-in-flight');
    expect(blocker?.panelId).toBe('panel-b');
    expect(focusB).toHaveBeenCalledOnce();
    expect(focusA).not.toHaveBeenCalled();
  });

  it('unregisters guards and allows clean panels', () => {
    const registry = new PanelLifecycleGuardRegistry();
    const unregister = registry.register('panel-a', () => null);
    expect(registry.firstBlocker(['panel-a'])).toBeNull();
    unregister();
    expect(registry.firstBlocker(['panel-a'])).toBeNull();
  });

  it.each([
    ['unsaved-yaml', 'Unsaved YAML changes', 'Save or discard'],
    ['mutation-in-flight', 'Operation in progress', 'Wait for'],
  ] as const)('explains a %s blocker when it receives focus', (reason, title, message) => {
    const registry = new PanelLifecycleGuardRegistry();
    const focus = vi.fn();
    const notify = vi.fn();
    const unsubscribe = subscribeToErrors(notify);
    try {
      registry.register('panel-a', () => ({ reason, focus }));
      const blocker = registry.firstBlocker(['panel-a']);
      expect(notify).not.toHaveBeenCalled();
      blocker?.focus();
      expect(focus).toHaveBeenCalledOnce();
      expect(notify).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          severity: 'warning',
          title,
          userMessage: expect.stringContaining(message),
        })
      );
    } finally {
      unsubscribe();
    }
  });

  it('provides required and optional hooks and registers the current hook guard', async () => {
    const focus = vi.fn();
    const captured: { registry: PanelLifecycleGuardRegistry | null } = { registry: null };
    const Probe = ({ panelId }: { panelId: string | null }) => {
      captured.registry = usePanelLifecycleGuardRegistry();
      expect(useOptionalPanelLifecycleGuardRegistry()).toBe(captured.registry);
      usePanelLifecycleGuard(panelId, () => ({ reason: 'unsaved-yaml', focus }));
      return null;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(
          PanelLifecycleGuardProvider,
          null,
          React.createElement(Probe, { panelId: 'panel-a' })
        )
      );
    });
    const blocker = captured.registry?.firstBlocker(['panel-a']);
    blocker?.focus();
    expect(blocker?.reason).toBe('unsaved-yaml');
    expect(focus).toHaveBeenCalledOnce();

    await act(async () => {
      root?.render(
        React.createElement(
          PanelLifecycleGuardProvider,
          null,
          React.createElement(Probe, { panelId: null })
        )
      );
    });
    expect(captured.registry?.firstBlocker(['panel-a'])).toBeNull();
  });

  it('rejects required hook use outside its provider', async () => {
    const Probe = () => {
      usePanelLifecycleGuardRegistry();
      return null;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await expect(
      act(async () => {
        root?.render(React.createElement(Probe));
      })
    ).rejects.toThrow('Panel lifecycle guards require PanelLifecycleGuardProvider');
  });
});

it('locks a clean renderer during handoff and releases only the matching transfer', () => {
  const registry = new PanelLifecycleGuardRegistry();
  const changed = vi.fn();
  registry.subscribe(changed);
  registry.freeze('move-a', ['panel-a']);
  registry.freeze('move-b', ['panel-b']);
  expect(registry.isFrozen()).toBe(true);
  expect(registry.isFrozen('move-a')).toBe(true);
  expect(registry.firstBlocker(['panel-a'])?.reason).toBe('transfer-in-flight');
  registry.releaseTransfer('move-a');
  expect(registry.isFrozen('move-b')).toBe(false);
  expect(registry.firstBlocker(['panel-a'])).toBeNull();
  expect(registry.isFrozen()).toBe(true);
  registry.releaseTransfer('move-b');
  expect(registry.isFrozen()).toBe(false);
  expect(changed).toHaveBeenCalledTimes(4);
});
