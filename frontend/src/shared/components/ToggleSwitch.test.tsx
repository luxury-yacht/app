/**
 * frontend/src/shared/components/ToggleSwitch.test.tsx
 *
 * Test suite for ToggleSwitch.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ToggleSwitch from './ToggleSwitch';

describe('ToggleSwitch', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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

  const render = async (props: React.ComponentProps<typeof ToggleSwitch>) => {
    await act(async () => {
      root.render(<ToggleSwitch {...props} />);
      await Promise.resolve();
    });
  };

  it('reflects checked state via aria-checked and modifier class', async () => {
    await render({ checked: true, onChange: vi.fn() });
    const button = container.querySelector('button.toggle-switch') as HTMLButtonElement;
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.className).toContain('toggle-switch--on');
  });

  it('renders off state', async () => {
    await render({ checked: false, onChange: vi.fn() });
    const button = container.querySelector('button.toggle-switch') as HTMLButtonElement;
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(button.className).toContain('toggle-switch--off');
  });

  it('toggles via click', async () => {
    const onChange = vi.fn();
    await render({ checked: false, onChange });
    const button = container.querySelector('button.toggle-switch') as HTMLButtonElement;
    act(() => {
      button.click();
    });
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggles via Space key', async () => {
    const onChange = vi.fn();
    await render({ checked: true, onChange });
    const button = container.querySelector('button.toggle-switch') as HTMLButtonElement;
    act(() => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does not fire onChange when disabled', async () => {
    const onChange = vi.fn();
    await render({ checked: false, onChange, disabled: true });
    const button = container.querySelector('button.toggle-switch') as HTMLButtonElement;
    act(() => {
      button.click();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
  });

  it('exposes role=switch with aria-label', async () => {
    await render({ checked: false, onChange: vi.fn(), ariaLabel: 'Enable feature' });
    const button = container.querySelector('button.toggle-switch') as HTMLButtonElement;
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-label')).toBe('Enable feature');
  });
});
