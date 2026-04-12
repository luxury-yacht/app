import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider } from '@ui/shortcuts/context';
import { useModalFocusTrap } from './useModalFocusTrap';

const TestModal: React.FC<{
  disabled?: boolean;
  onEscape?: (event: KeyboardEvent) => boolean | void;
}> = ({ disabled = false, onEscape }) => {
  const ref = React.useRef<HTMLDivElement>(null);

  useModalFocusTrap({
    ref,
    disabled,
    onEscape,
  });

  return (
    <div ref={ref} className="modal-container" role="dialog" aria-modal="true" tabIndex={-1}>
      <input aria-label="First input" />
      <button>Second</button>
    </div>
  );
};

describe('useModalFocusTrap', () => {
  let appRoot: HTMLDivElement;
  let outsideButton: HTMLButtonElement;
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    appRoot = document.createElement('div');
    appRoot.id = 'app';
    outsideButton = document.createElement('button');
    outsideButton.textContent = 'Outside';
    appRoot.appendChild(outsideButton);
    document.body.appendChild(appRoot);

    container = document.createElement('div');
    container.className = 'modal-overlay';
    container.setAttribute('data-modal-surface', 'true');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    appRoot.remove();
  });

  it('focuses the first tabbable control, traps Tab, and inerts the background', async () => {
    outsideButton.focus();

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <TestModal />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>('.modal-container input, .modal-container button')
    );
    expect(controls).toHaveLength(2);
    expect(document.activeElement).toBe(controls[0]);
    expect(appRoot.getAttribute('inert')).toBe('');
    expect(appRoot.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(controls[1]);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(controls[0]);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
    });
    expect(document.activeElement).toBe(controls[1]);
  });

  it('redirects escaped focus back inside and restores prior focus on close', async () => {
    outsideButton.focus();

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <TestModal />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const controls = Array.from(
      document.querySelectorAll<HTMLElement>('.modal-container input, .modal-container button')
    );
    expect(document.activeElement).toBe(controls[0]);

    act(() => {
      outsideButton.focus();
    });
    expect(document.activeElement).toBe(controls[0]);

    act(() => {
      root.unmount();
    });

    expect(document.activeElement).toBe(outsideButton);
    expect(appRoot.hasAttribute('inert')).toBe(false);
    expect(appRoot.hasAttribute('aria-hidden')).toBe(false);

    root = ReactDOM.createRoot(container);
  });

  it('does nothing when disabled', async () => {
    outsideButton.focus();

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <TestModal disabled />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(outsideButton);
    expect(appRoot.hasAttribute('inert')).toBe(false);
    expect(appRoot.hasAttribute('aria-hidden')).toBe(false);
  });

  it('routes Escape through the modal surface when an input has focus', async () => {
    const onEscape = vi.fn(() => true);

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <TestModal onEscape={onEscape} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const input = document.querySelector<HTMLInputElement>('.modal-container input');
    expect(input).not.toBeNull();
    input?.focus();

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      input?.dispatchEvent(event);
    });

    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});
