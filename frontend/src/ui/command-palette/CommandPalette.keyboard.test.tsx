import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { KeyboardProvider } from '@ui/shortcuts/context';
import { useKeyboardSurface } from '@ui/shortcuts/surfaces';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import { eventBus } from '@/core/events';
import { requireValue } from '@/test-utils/requireValue';
import { ApplicationMenuCommandProvider } from '@/ui/layout/ApplicationMenuCommandContext';
import { ApplicationMenuShortcuts } from '@/ui/shortcuts/components/ApplicationMenuShortcuts';
import { CommandPalette } from './CommandPalette';
import type { Command } from './CommandPaletteCommands';

const openWithObjectMock = vi.fn();

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
  }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'alpha:ctx' }),
}));

vi.mock('@hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@/core/refresh/client', () => ({
  fetchSnapshot: vi.fn().mockResolvedValue({ snapshot: null }),
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: () => false,
  usesCustomWindowFrame: () => true,
}));

const dispatchOpenCommand = () => eventBus.emit('command-palette:open');

const macPlatform =
  typeof navigator !== 'undefined' &&
  /Mac/i.test((navigator.platform || '') + (navigator.userAgent || ''));

const dispatchNamespaceShortcut = (target: EventTarget = document) => {
  const event = new KeyboardEvent('keydown', {
    key: 'N',
    bubbles: true,
    cancelable: true,
    shiftKey: true,
    ...(macPlatform ? { metaKey: true } : { ctrlKey: true }),
  });

  if (target instanceof Node) {
    target.dispatchEvent(event);
  } else {
    document.dispatchEvent(event);
  }

  return event;
};

function BlockingSurfaceHarness() {
  const ref = React.useRef<HTMLDivElement>(null);

  useKeyboardSurface({
    kind: 'modal',
    rootRef: ref,
    active: true,
    blocking: true,
  });

  return <div ref={ref}>Blocking surface</div>;
}

function SharedModalHarness() {
  const modalRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  useModalFocusTrap({
    ref: modalRef,
    disabled: false,
  });

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy={titleId}
      onClose={() => undefined}
      containerClassName="test-blocking-modal"
      closeOnBackdrop={false}
    >
      <div className="modal-header">
        <h2 id={titleId}>Blocking modal</h2>
      </div>
      <div className="modal-content">
        <button type="button">Inside modal</button>
      </div>
    </ModalSurface>
  );
}

describe('CommandPalette keyboard integration', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    openWithObjectMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('keeps an open palette intact when its application accelerator is pressed again', async () => {
    const execute = (menuCommand: backend.ApplicationMenuCommand) => {
      if (menuCommand === backend.ApplicationMenuCommand.ApplicationMenuCommandCommandPalette) {
        eventBus.emit('command-palette:open');
      }
    };
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ApplicationMenuCommandProvider execute={execute}>
            <ApplicationMenuShortcuts />
            <CommandPalette
              commands={[{ id: 'first', label: 'First', category: 'Application', action: vi.fn() }]}
            />
          </ApplicationMenuCommandProvider>
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
    await act(async () => {
      eventBus.emit('command-palette:open');
      await Promise.resolve();
    });

    const input = requireValue(
      document.querySelector<HTMLInputElement>('.command-palette-input'),
      'expected command palette input'
    );
    await act(async () => {
      input.value = 'fir';
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'p',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).not.toBeNull();
    expect(input.value).toBe('fir');
  });

  it('switches an open palette into kubeconfig mode when Ctrl+O is pressed', async () => {
    const execute = (menuCommand: backend.ApplicationMenuCommand) => {
      if (menuCommand === backend.ApplicationMenuCommand.ApplicationMenuCommandOpenCluster) {
        eventBus.emit('command-palette:open-kubeconfigs');
      }
    };
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ApplicationMenuCommandProvider execute={execute}>
            <ApplicationMenuShortcuts />
            <CommandPalette
              commands={[
                { id: 'kc-a', label: 'cluster-a', category: 'Kubeconfigs', action: vi.fn() },
              ]}
            />
          </ApplicationMenuCommandProvider>
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
    await act(async () => {
      eventBus.emit('command-palette:open');
      await Promise.resolve();
    });

    const input = requireValue(
      document.querySelector<HTMLInputElement>('.command-palette-input'),
      'expected command palette input'
    );
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'o',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).not.toBeNull();
    expect(input.placeholder).toBe('Select a kubeconfig...');
  });

  it('navigates and activates results through the palette surface while the input is focused', async () => {
    vi.useFakeTimers();
    const firstAction = vi.fn();
    const secondAction = vi.fn();
    const commands: Command[] = [
      { id: 'first', label: 'First', category: 'Application', action: firstAction },
      { id: 'second', label: 'Second', category: 'Application', action: secondAction },
    ];

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <CommandPalette commands={commands} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    await act(async () => {
      dispatchOpenCommand();
      await Promise.resolve();
    });

    const input = document.querySelector<HTMLInputElement>('.command-palette-input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);

    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    const items = Array.from(document.querySelectorAll<HTMLDivElement>('.command-palette-item'));
    expect(items[1]?.classList.contains('selected')).toBe(true);

    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(secondAction).toHaveBeenCalledTimes(1);
    expect(firstAction).not.toHaveBeenCalled();
  });

  it('closes on Escape through the palette surface while the input is focused', async () => {
    const commands: Command[] = [
      { id: 'first', label: 'First', category: 'Application', action: vi.fn() },
    ];

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <CommandPalette commands={commands} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    await act(async () => {
      dispatchOpenCommand();
      await Promise.resolve();
    });

    const input = document.querySelector<HTMLInputElement>('.command-palette-input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);

    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).toBeNull();
  });

  it('closes on the first Escape when opened directly in kubeconfig mode', async () => {
    const commands: Command[] = [
      { id: 'kc-a', label: 'cluster-a', category: 'Kubeconfigs', action: vi.fn() },
    ];

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <CommandPalette commands={commands} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    await act(async () => {
      eventBus.emit('command-palette:open-kubeconfigs');
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).not.toBeNull();

    const input = document.querySelector<HTMLInputElement>('.command-palette-input');
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).toBeNull();
  });

  it('opens directly in namespaces mode on the namespace shortcut and closes on first Escape', async () => {
    const commands: Command[] = [
      { id: 'ns-prod', label: 'prod', category: 'Namespaces', action: vi.fn() },
      { id: 'view-x', label: 'Toggle X', category: 'View', action: vi.fn() },
    ];

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <CommandPalette commands={commands} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    await act(async () => {
      dispatchNamespaceShortcut();
      await Promise.resolve();
    });

    const input = requireValue(
      document.querySelector<HTMLInputElement>('.command-palette-input'),
      'expected the command-palette input'
    );
    expect(input.placeholder).toBe('Select a namespace...');
    const labels = Array.from(
      document.querySelectorAll<HTMLDivElement>('.command-palette-item-label')
    ).map((el) => el.textContent);
    expect(labels).toEqual(['prod']);

    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).toBeNull();
  });

  it('does not open in namespaces mode while another blocking surface is active', async () => {
    const commands: Command[] = [
      { id: 'ns-prod', label: 'prod', category: 'Namespaces', action: vi.fn() },
    ];

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <BlockingSurfaceHarness />
          <CommandPalette commands={commands} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    await act(async () => {
      dispatchNamespaceShortcut();
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).toBeNull();
  });

  it('does not open while another blocking surface is active', async () => {
    const commands: Command[] = [
      { id: 'first', label: 'First', category: 'Application', action: vi.fn() },
    ];

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <BlockingSurfaceHarness />
          <CommandPalette commands={commands} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    await act(async () => {
      dispatchOpenCommand();
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).toBeNull();
  });

  it('does not open while a shared modal surface is active', async () => {
    const commands: Command[] = [
      { id: 'first', label: 'First', category: 'Application', action: vi.fn() },
    ];

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <SharedModalHarness />
          <CommandPalette commands={commands} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    await act(async () => {
      dispatchOpenCommand();
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).toBeNull();
    expect(document.querySelector('.test-blocking-modal')).not.toBeNull();
  });
});
