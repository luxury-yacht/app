import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useModalFocusTrap } from './useModalFocusTrap';

const TestModal: React.FC<{ disabled?: boolean }> = ({ disabled = false }) => {
  const ref = React.useRef<HTMLDivElement>(null);

  useModalFocusTrap({
    ref,
    disabled,
  });

  return (
    <div ref={ref} className="modal-container" role="dialog" aria-modal="true" tabIndex={-1}>
      <button>First</button>
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
      root.render(<TestModal />);
      await Promise.resolve();
    });

    const buttons = Array.from(document.querySelectorAll('.modal-container button'));
    expect(buttons).toHaveLength(2);
    expect(document.activeElement).toBe(buttons[0]);
    expect(appRoot.getAttribute('inert')).toBe('');
    expect(appRoot.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[1]);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(buttons[0]);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
    });
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('redirects escaped focus back inside and restores prior focus on close', async () => {
    outsideButton.focus();

    await act(async () => {
      root.render(<TestModal />);
      await Promise.resolve();
    });

    const buttons = Array.from(document.querySelectorAll('.modal-container button'));
    expect(document.activeElement).toBe(buttons[0]);

    act(() => {
      outsideButton.focus();
    });
    expect(document.activeElement).toBe(buttons[0]);

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
      root.render(<TestModal disabled />);
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(outsideButton);
    expect(appRoot.hasAttribute('inert')).toBe(false);
    expect(appRoot.hasAttribute('aria-hidden')).toBe(false);
  });
});
