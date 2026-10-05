import { ZoomProvider } from '@core/contexts/ZoomContext';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import IconBar, { type IconBarItem } from './IconBar';

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: vi.fn(() => () => undefined),
}));

vi.mock('@core/backend-api', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));

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

it('toggles from the split button and picks a related choice from its menu', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onToggle = vi.fn();
  const chooseLocal = vi.fn();
  const splitToggle = (disabled: boolean): IconBarItem[] => [
    {
      type: 'split',
      behavior: 'toggle',
      id: 'timestamps',
      icon: 'T',
      title: 'Show timestamps',
      active: true,
      onClick: onToggle,
      disabled,
      menuLabel: 'Time zone',
      menuItems: [
        { label: 'UTC', checked: true, onClick: vi.fn() },
        { label: 'Local', checked: false, onClick: chooseLocal },
      ],
    },
  ];
  const render = async (disabled = false) =>
    act(async () => {
      root.render(
        <ZoomProvider>
          <KeyboardProvider>
            <IconBar items={splitToggle(disabled)} />
          </KeyboardProvider>
        </ZoomProvider>
      );
      await Promise.resolve();
    });
  const menu = () => document.body.querySelector('[role="menu"]');
  const pressCaret = (caret: HTMLButtonElement) =>
    act(async () => {
      caret.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      caret.click();
      await Promise.resolve();
    });
  try {
    await render();
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Show timestamps"]');
    const caret = container.querySelector<HTMLButtonElement>('[aria-label="Time zone"]');
    if (!toggle || !caret) {
      throw new Error('split toggle buttons not rendered');
    }
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(caret.getAttribute('aria-haspopup')).toBe('menu');

    act(() => toggle.click());
    expect(onToggle).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();

    await pressCaret(caret);
    expect(caret.getAttribute('aria-expanded')).toBe('true');
    const local = Array.from(menu()?.querySelectorAll('[role="menuitemradio"]') ?? []).find(
      (item) => item.textContent === 'Local'
    );
    await act(async () => {
      local?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(chooseLocal).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();
    expect(caret.getAttribute('aria-expanded')).toBe('false');

    // A second press on the caret closes the open menu instead of reopening it.
    await pressCaret(caret);
    expect(menu()).not.toBeNull();
    await pressCaret(caret);
    expect(menu()).toBeNull();
    expect(onToggle).toHaveBeenCalledOnce();

    await render(true);
    expect(toggle.disabled).toBe(true);
    expect(caret.disabled).toBe(true);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it('steps a cycle split button without reporting a pressed state', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onCycle = vi.fn();
  try {
    act(() =>
      root.render(
        <IconBar
          items={[
            {
              type: 'split',
              behavior: 'cycle',
              id: 'format',
              icon: 'F',
              title: 'Log format: Pretty',
              active: true,
              onClick: onCycle,
              menuLabel: 'Log format',
              menuItems: [],
            },
          ]}
        />
      )
    );
    const cycle = container.querySelector<HTMLButtonElement>('[aria-label="Log format: Pretty"]');
    expect(cycle?.hasAttribute('aria-pressed')).toBe(false);
    expect(
      container.querySelector('[aria-label="Log format"]')?.getAttribute('aria-haspopup')
    ).toBe('menu');
    act(() => cycle?.click());
    expect(onCycle).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
