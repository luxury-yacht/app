import * as React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
