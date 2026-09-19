import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import IconBar, { type IconBarItem } from './IconBar';

it('preserves toolbar controls alongside separators with colliding labels', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onAction = vi.fn();
  const onToggle = vi.fn();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const items: IconBarItem[] = [
    { type: 'separator' },
    { type: 'separator' },
    { type: 'action', id: 'separator#2', icon: 'A', title: 'Run action', onClick: onAction },
    {
      type: 'toggle',
      id: 'separator',
      icon: 'T',
      title: 'Toggle view',
      active: false,
      onClick: onToggle,
    },
  ];
  try {
    act(() => root.render(<IconBar items={items} />));
    const action = container.querySelector<HTMLButtonElement>('[aria-label="Run action"]');
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Toggle view"]');
    expect(action).not.toBeNull();
    expect(toggle).not.toBeNull();
    act(() => {
      action?.click();
      toggle?.click();
    });
    expect(onAction).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledOnce();
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(action?.hasAttribute('aria-pressed')).toBe(false);
    act(() => root.render(<IconBar items={items.slice(1)} />));
    expect(container.querySelector('[aria-label="Run action"]')).toBe(action);
    expect(container.querySelector('[aria-label="Toggle view"]')).toBe(toggle);
    expect(errors.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
    errors.mockRestore();
  }
});
