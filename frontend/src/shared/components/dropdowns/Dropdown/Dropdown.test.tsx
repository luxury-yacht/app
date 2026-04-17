/**
 * frontend/src/shared/components/dropdowns/Dropdown/Dropdown.test.tsx
 *
 * Test suite for Dropdown.
 * Covers key behaviors and edge cases for Dropdown.
 */

import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

  const setTextInputValue = async (input: HTMLInputElement | null, value: string) => {
    if (!input) throw new Error('Input not found');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, value);
    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
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

    await setTextInputValue(searchInput, 'gam');

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

  it('filters visible options for local searchable dropdowns and keeps keyboard navigation on filtered options', async () => {
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
          searchable
        />
      );
    };

    await mount(<Harness />);

    click(container.querySelector('.dropdown-trigger'));

    const searchInput = container.querySelector<HTMLInputElement>('.search-input');
    expect(searchInput).not.toBeNull();

    await setTextInputValue(searchInput, 'gam');

    const optionLabels = Array.from(container.querySelectorAll('.dropdown-option')).map((node) =>
      node.textContent?.trim()
    );
    expect(optionLabels).toEqual(['Gamma']);

    await pressKey(searchInput, 'ArrowDown');
    expect(container.querySelector('.dropdown-option.highlighted')?.textContent).toContain('Gamma');

    await pressKey(searchInput, 'Enter');
    expect(handleChange).toHaveBeenCalledWith('gamma');
  });

  it('supports remote search without locally filtering the provided options', async () => {
    const onSearchChange = vi.fn();

    await mount(
      <Dropdown
        options={OPTIONS}
        value=""
        onChange={vi.fn()}
        searchable
        searchMode="remote"
        searchValue="ga"
        onSearchChange={onSearchChange}
      />
    );

    click(container.querySelector('.dropdown-trigger'));

    const optionLabels = Array.from(container.querySelectorAll('.dropdown-option')).map((node) =>
      node.textContent?.trim()
    );
    expect(optionLabels).toEqual(['Alpha', 'Beta', 'Gamma']);

    const searchInput = container.querySelector<HTMLInputElement>('.search-input');
    expect(searchInput?.value).toBe('ga');

    await setTextInputValue(searchInput, 'bet');

    expect(onSearchChange).toHaveBeenCalledWith('bet');

    click(container.querySelector('.dropdown-trigger'));
    expect(onSearchChange).toHaveBeenCalledWith('');
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

  it('supports keyboard navigation while the search input has focus', async () => {
    await mount(
      <Dropdown options={OPTIONS} value="" onChange={vi.fn()} searchable placeholder="Searchable" />
    );

    click(container.querySelector('.dropdown-trigger'));

    const searchInput = container.querySelector<HTMLInputElement>('.search-input');
    expect(searchInput).not.toBeNull();
    searchInput?.focus();

    await pressKey(searchInput, 'ArrowDown');
    expect(container.querySelector('.dropdown-option.highlighted')?.textContent).toContain('Alpha');

    await pressKey(searchInput, 'ArrowDown');
    expect(container.querySelector('.dropdown-option.highlighted')?.textContent).toContain('Beta');
  });

  it('removes the trigger highlight while the internal search input is focused', async () => {
    await mount(
      <Dropdown options={OPTIONS} value="" onChange={vi.fn()} searchable placeholder="Searchable" />
    );

    click(container.querySelector('.dropdown-trigger'));

    const dropdown = container.querySelector('.dropdown') as HTMLElement | null;
    const searchInput = container.querySelector<HTMLInputElement>('.search-input');
    expect(dropdown).not.toBeNull();
    expect(searchInput).not.toBeNull();

    await act(async () => {
      searchInput?.focus();
      await Promise.resolve();
    });

    expect(dropdown?.classList.contains('search-focused')).toBe(true);

    await act(async () => {
      searchInput?.blur();
      await Promise.resolve();
    });

    expect(dropdown?.classList.contains('search-focused')).toBe(false);
  });

  it('closes on Tab without preventing the browser focus move', async () => {
    await mount(
      <Dropdown options={OPTIONS} value="" onChange={vi.fn()} searchable placeholder="Searchable" />
    );

    click(container.querySelector('.dropdown-trigger'));

    const searchInput = container.querySelector<HTMLInputElement>('.search-input');
    expect(searchInput).not.toBeNull();
    searchInput?.focus();

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => {
      searchInput?.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(container.querySelector('.dropdown-menu')).toBeNull();
    expect(event.defaultPrevented).toBe(false);
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

  it('supports select all and select none bulk actions for visible multi-select options', async () => {
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
            { value: 'sqlite', label: 'SQLite' },
          ]}
          value={value}
          multiple
          showBulkActions
          onChange={(next) => {
            const nextValue = Array.isArray(next) ? next : [];
            onChange(nextValue);
            setValue(nextValue);
          }}
        />
      );
    };

    await mount(<Harness />);

    click(container.querySelector('.dropdown-trigger'));

    const bulkButtons = container.querySelectorAll<HTMLButtonElement>('.dropdown-bulk-action');
    expect(bulkButtons).toHaveLength(2);
    expect(bulkButtons[0]?.getAttribute('aria-label')).toBe('Select all');
    expect(bulkButtons[1]?.getAttribute('aria-label')).toBe('Select none');

    click(bulkButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['postgres', 'mongo', 'sqlite']);

    const selectNoneButton =
      container.querySelectorAll<HTMLButtonElement>('.dropdown-bulk-action')[1];
    click(selectNoneButton);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('renders the searchable input and bulk actions on the same control row', async () => {
    await mount(
      <Dropdown
        options={OPTIONS}
        value={[]}
        onChange={vi.fn()}
        multiple
        searchable
        showBulkActions
      />
    );

    click(container.querySelector('.dropdown-trigger'));

    const controls = container.querySelector('.dropdown-menu-controls');
    expect(controls).not.toBeNull();
    expect(controls?.querySelector('.search-input')).not.toBeNull();
    expect(controls?.querySelectorAll('.dropdown-bulk-action')).toHaveLength(2);
  });

  it('shows text labels beside bulk-action icons when search is disabled', async () => {
    await mount(
      <Dropdown options={OPTIONS} value={[]} onChange={vi.fn()} multiple showBulkActions />
    );

    click(container.querySelector('.dropdown-trigger'));

    const bulkButtons = container.querySelectorAll<HTMLButtonElement>('.dropdown-bulk-action');
    expect(bulkButtons).toHaveLength(2);
    expect(bulkButtons[0]?.textContent).toContain('Select All');
    expect(bulkButtons[1]?.textContent).toContain('Select None');
    expect(container.querySelector('.search-input')).toBeNull();
  });

  it('preserves menu scroll position across multi-select updates', async () => {
    const manyOptions = Array.from({ length: 40 }, (_, index) => ({
      value: `opt-${index}`,
      label: `Option ${index}`,
    }));

    const Harness = () => {
      const [value, setValue] = useState<string[]>([]);
      return (
        <Dropdown
          options={manyOptions}
          value={value}
          onChange={(next) => {
            setValue(Array.isArray(next) ? next : [next]);
          }}
          multiple
        />
      );
    };

    await mount(<Harness />);
    click(container.querySelector('.dropdown-trigger'));

    const menu = container.querySelector('.dropdown-menu') as HTMLDivElement | null;
    expect(menu).not.toBeNull();
    if (!menu) {
      return;
    }

    menu.scrollTop = 180;
    await act(async () => {
      menu.dispatchEvent(new Event('scroll'));
      await Promise.resolve();
    });

    const targetOption = container.querySelectorAll('.dropdown-option')[25];
    click(targetOption);

    const updatedMenu = container.querySelector('.dropdown-menu') as HTMLDivElement | null;
    expect(updatedMenu).not.toBeNull();
    expect(updatedMenu?.scrollTop).toBe(180);
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
});
