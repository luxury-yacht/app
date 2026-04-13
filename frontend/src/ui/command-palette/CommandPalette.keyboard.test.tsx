import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider } from '@ui/shortcuts/context';
import { useKeyboardSurface } from '@ui/shortcuts/surfaces';
import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import type { Command } from './CommandPaletteCommands';
import { CommandPalette } from './CommandPalette';

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

const macPlatform =
  typeof navigator !== 'undefined' &&
  /Mac/i.test((navigator.platform || '') + (navigator.userAgent || ''));

const dispatchOpenShortcut = (target: EventTarget = document) => {
  const event = new KeyboardEvent('keydown', {
    key: 'P',
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

  useModalFocusTrap({
    ref: modalRef,
    disabled: false,
  });

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="blocking-modal-title"
      onClose={() => {}}
      containerClassName="test-blocking-modal"
      closeOnBackdrop={false}
    >
      <div className="modal-header">
        <h2 id="blocking-modal-title">Blocking modal</h2>
      </div>
      <div className="modal-content">
        <button>Inside modal</button>
      </div>
    </ModalSurface>
  );
}

describe('CommandPalette keyboard integration', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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
      dispatchOpenShortcut();
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
      dispatchOpenShortcut();
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
      dispatchOpenShortcut();
      await Promise.resolve();
    });

    expect(document.querySelector('.command-palette')).toBeNull();
    expect(document.querySelector('.test-blocking-modal')).not.toBeNull();
  });
});
