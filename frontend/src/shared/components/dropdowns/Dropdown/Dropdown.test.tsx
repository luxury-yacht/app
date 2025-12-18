import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const shortcutRegistry = vi.hoisted(() => ({
  entries: [] as Array<{ key: string; handler: () => boolean | void; enabled?: boolean }>,
}));

vi.mock('@ui/shortcuts', async () => {
  const actual = await vi.importActual<typeof import('@ui/shortcuts')>('@ui/shortcuts');
  return {
    ...actual,
    useShortcuts: (
      shortcuts: Array<{ key: string; handler: () => boolean | void; enabled?: boolean }>,
      config?: unknown
    ) => {
      shortcutRegistry.entries = shortcuts;
      return actual.useShortcuts(shortcuts, config as any);
    },
  };
});

import Dropdown from './Dropdown';
import type { DropdownOption } from './types';
import { KeyboardProvider } from '@ui/shortcuts';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

const OPTIONS: DropdownOption[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
];

describe('Dropdown', () => {
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
    shortcutRegistry.entries = [];
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
  });

  const mount = async (element: React.ReactElement) => {
    await act(async () => {
      root.render(<KeyboardProvider>{element}</KeyboardProvider>);
      await Promise.resolve();
    });
  };

  const click = (element: Element | null) => {
    if (!element) throw new Error('Element not found');
    act(() => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  const pressKey = async (element: Element | null, key: string) => {
    if (!element) throw new Error('Element not found');
    await act(async () => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await Promise.resolve();
    });
  };

  it('opens the menu and selects an option', async () => {
    const handleChange = vi.fn();

    const Harness = () => {
      const [value, setValue] = useState('');
      return (
        <Dropdown
          options={OPTIONS}
          value={value}
          onChange={(next) => {
            handleChange(next);
            setValue(next as string);
          }}
          placeholder="Pick one"
        />
      );
    };

    await mount(<Harness />);

    const trigger = container.querySelector('.dropdown-trigger');
    click(trigger);

    const secondOption = container.querySelectorAll('.dropdown-option').item(1);
    click(secondOption);

    expect(handleChange).toHaveBeenCalledWith('beta');
    expect(container.querySelector('.dropdown-menu')).toBeNull();
    expect(container.querySelector('.dropdown-value')?.textContent).toBe('Beta');
  });

  it('supports search input and clearing selection', async () => {
    const handleChange = vi.fn();

    const Harness = () => {
      const [value, setValue] = useState('beta');
      return (
        <Dropdown
          options={OPTIONS}
          value={value}
          onChange={(next) => {
            handleChange(next);
            setValue((next as string) ?? '');
          }}
          searchable
          clearable
        />
      );
    };

    await mount(<Harness />);

    click(container.querySelector('.dropdown-trigger'));

    const searchInput = container.querySelector<HTMLInputElement>('.search-input');
    expect(searchInput).not.toBeNull();

    await act(async () => {
      searchInput!.value = 'gam';
      const eventInit = { bubbles: true } as EventInit;
      searchInput!.dispatchEvent(new Event('input', eventInit));
      searchInput!.dispatchEvent(new Event('change', eventInit));
      await Promise.resolve();
    });

    expect(searchInput!.value).toBe('gam');

    const clearButton = container.querySelector<HTMLButtonElement>('.clear-button');
    expect(clearButton).not.toBeNull();
    click(clearButton);

    expect(handleChange).toHaveBeenCalledWith('');
    expect(container.querySelector('.dropdown-value')?.textContent).toBe('Select...');

    // Closing the dropdown should reset the search query
    click(container.querySelector('.dropdown-trigger'));
    click(container.querySelector('.dropdown-trigger'));

    const reopenedInput = container.querySelector<HTMLInputElement>('.search-input');
    expect(reopenedInput?.value ?? '').toBe('');
  });

  it('renders an empty state when no options are available', async () => {
    await mount(
      <Dropdown options={[]} value="" onChange={vi.fn()} searchable placeholder="Nothing" />
    );

    click(container.querySelector('.dropdown-trigger'));
    expect(container.querySelector('.no-options')?.textContent).toContain('No options available');
  });

  it('supports keyboard navigation for single-select dropdown', async () => {
    const handleChange = vi.fn();

    const Harness = () => {
      const [value, setValue] = useState('');
      return (
        <Dropdown
          options={OPTIONS}
          value={value}
          onChange={(next) => {
            handleChange(next);
            setValue(next as string);
          }}
        />
      );
    };

    await mount(<Harness />);

    const trigger = container.querySelector('.dropdown-trigger');
    click(trigger);

    await pressKey(trigger, 'ArrowDown');
    expect(container.querySelector('.dropdown-option.highlighted')?.textContent).toContain('Alpha');

    await pressKey(trigger, 'ArrowDown');
    expect(container.querySelector('.dropdown-option.highlighted')?.textContent).toContain('Beta');

    await pressKey(trigger, 'Enter');
    expect(handleChange).toHaveBeenCalledWith('beta');
  });

  it('invokes onOpen and onClose callbacks', async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();

    await mount(
      <Dropdown options={OPTIONS} value="" onChange={vi.fn()} onOpen={onOpen} onClose={onClose} />
    );

    const trigger = container.querySelector('.dropdown-trigger');
    click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);

    click(trigger);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports multi-select mode with custom renderers and guarded options', async () => {
    const onChange = vi.fn<(value: string[]) => void>();
    const Harness = () => {
      const [value, setValue] = useState<string[]>(['postgres']);
      return (
        <Dropdown
          options={[
            { value: 'group-databases', label: 'Databases', group: 'header' },
            { value: 'postgres', label: 'Postgres' },
            { value: 'redis', label: 'Redis', disabled: true },
            { value: 'mongo', label: 'Mongo' },
          ]}
          value={value}
          multiple
          searchable
          renderOption={(option, isSelected) => (
            <span data-testid={`option-${option.value}`}>
              {isSelected ? `✓ ${option.label}` : option.label}
            </span>
          )}
          renderValue={(current) =>
            Array.isArray(current) && current.length > 0
              ? `Selected: ${current.join('|')}`
              : 'Choose'
          }
          onChange={(next) => {
            const nextValue = Array.isArray(next) ? next : [];
            onChange(nextValue);
            setValue(nextValue);
          }}
        />
      );
    };

    await mount(<Harness />);

    const trigger = container.querySelector('.dropdown-trigger');
    click(trigger);

    const groupHeader = container.querySelector('.dropdown-group-header');
    expect(groupHeader?.textContent).toBe('Databases');
    click(groupHeader);
    expect(onChange).not.toHaveBeenCalled();

    const disabledOption = container.querySelector('.dropdown-option.disabled');
    expect(disabledOption?.textContent).toBe('Redis');
    click(disabledOption);
    expect(onChange).not.toHaveBeenCalled();

    const mongoOption = container.querySelector('[data-testid="option-mongo"]');
    click(mongoOption);
    expect(onChange).toHaveBeenCalledWith(['postgres', 'mongo']);
    expect(container.querySelector('.dropdown-value')?.textContent).toBe(
      'Selected: postgres|mongo'
    );
  });

  it('adjusts menu position when space below trigger is limited', async () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });

    const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return this.classList.contains('dropdown-menu')
          ? 280
          : (offsetHeightDescriptor?.get?.call(this) ?? 0);
      },
    });

    await mount(<Dropdown options={OPTIONS} value="" onChange={vi.fn()} />);

    const trigger = container.querySelector('.dropdown-trigger') as HTMLElement;
    Object.defineProperty(trigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 500,
        bottom: 540,
        height: 40,
        width: 200,
        left: 0,
        right: 200,
        x: 0,
        y: 500,
        toJSON: () => {},
      }),
    });

    click(trigger);

    const menu = container.querySelector('.dropdown-menu');
    expect(menu?.className).toContain('position-top');

    if (offsetHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor);
    } else {
      delete (HTMLElement.prototype as any).offsetHeight;
    }
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  it('respects loading and disabled states', async () => {
    const handleChange = vi.fn();

    await mount(
      <Dropdown options={OPTIONS} value="" onChange={handleChange} loading placeholder="Pick" />
    );

    expect(container.querySelector('.dropdown-value')?.textContent).toBe('Loading...');
    click(container.querySelector('.dropdown-trigger'));
    expect(container.querySelector('.dropdown-menu')).toBeNull();

    await mount(
      <Dropdown options={OPTIONS} value="" onChange={handleChange} disabled placeholder="Pick" />
    );

    click(container.querySelector('.dropdown-trigger'));
    expect(container.querySelector('.dropdown-menu')).toBeNull();
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('renders form input values when name is provided', async () => {
    await mount(
      <Dropdown options={OPTIONS} value="beta" onChange={vi.fn()} name="example" id="example-id" />
    );

    const hidden = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="example"]'
    );
    expect(hidden).toBeTruthy();
    expect(hidden?.value).toBe('beta');
    const trigger = container.querySelector('.dropdown-trigger');
    expect(trigger?.getAttribute('aria-controls')).toBe('example-id-menu');
  });

  it('invokes shortcut handlers registered through useShortcuts', async () => {
    const handleChange = vi.fn();
    await mount(
      <Dropdown options={OPTIONS} value="" onChange={handleChange} searchable clearable />
    );

    const trigger = container.querySelector('.dropdown-trigger');
    click(trigger);
    expect(shortcutRegistry.entries).not.toHaveLength(0);

    const getShortcut = (key: string) =>
      shortcutRegistry.entries.find((entry) => entry.key === key)?.handler;

    await act(async () => {
      expect(getShortcut('ArrowDown')?.()).toBe(true);
      await Promise.resolve();
    });

    await act(async () => {
      expect(getShortcut('ArrowUp')?.()).toBe(true);
      await Promise.resolve();
    });

    const searchInput = container.querySelector<HTMLInputElement>('.search-input');
    await act(async () => {
      searchInput?.focus();
      await Promise.resolve();
    });
    const spaceWhileTyping = getShortcut(' ');
    await act(async () => {
      const result = spaceWhileTyping?.();
      expect(result).toBe(false);
      await Promise.resolve();
    });

    await act(async () => {
      searchInput?.blur();
      await Promise.resolve();
    });
    await act(async () => {
      getShortcut(' ')?.();
      await Promise.resolve();
    });
    expect(handleChange).toHaveBeenCalledWith(expect.any(String));

    await act(async () => {
      expect(getShortcut('Home')?.()).toBe(true);
      await Promise.resolve();
    });

    await act(async () => {
      expect(getShortcut('End')?.()).toBe(true);
      await Promise.resolve();
    });

    await act(async () => {
      expect(getShortcut('Escape')?.()).toBe(true);
      await Promise.resolve();
    });
    expect(container.querySelector('.dropdown-menu')).toBeNull();
  });
});
