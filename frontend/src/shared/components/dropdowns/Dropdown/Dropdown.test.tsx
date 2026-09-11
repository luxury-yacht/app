/**
 * frontend/src/shared/components/dropdowns/Dropdown/Dropdown.test.tsx
 *
 * Test suite for Dropdown.
 * Covers key behaviors and edge cases for Dropdown.
 */

import { KeyboardProvider } from '@ui/shortcuts';
import type React from 'react';
import { act, useEffect, useRef, useState } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestId } from '@/test-utils/createTestId';
import { requireValue } from '@/test-utils/requireValue';
import Dropdown from './Dropdown';
import type { DropdownOption } from './types';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(() => () => undefined),
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: runtimeMocks.eventsOn,
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
    runtimeMocks.eventsOn.mockReset().mockReturnValue(() => undefined);
  });

  const mount = async (element: React.ReactElement) => {
    await act(async () => {
      root.render(<KeyboardProvider>{element}</KeyboardProvider>);
      await Promise.resolve();
    });
  };

  const click = (element: Element | null) => {
    if (!element) {
      throw new Error('Element not found');
    }
    act(() => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  const mouseDown = (element: Element | null) => {
    if (!element) {
      throw new Error('Element not found');
    }
    act(() => {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
  };

  const pressKey = async (
    element: Element | null,
    key: string,
    init: Omit<KeyboardEventInit, 'key' | 'bubbles'> = {}
  ) => {
    if (!element) {
      throw new Error('Element not found');
    }
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    await act(async () => {
      element.dispatchEvent(event);
      await Promise.resolve();
    });
    return event;
  };

  const optionIn = (label: string) =>
    requireValue(
      Array.from(document.body.querySelectorAll<HTMLElement>('.dropdown-option')).find(
        (option) => option.textContent?.trim() === label
      ),
      `expected option ${label}`
    );

  const onlyIn = (label: string) =>
    document.body.querySelector<HTMLButtonElement>(`button[aria-label="Select only ${label}"]`);

  const setTextInputValue = async (input: HTMLInputElement | null, value: string) => {
    if (!input) {
      throw new Error('Input not found');
    }
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

    const secondOption = document.body.querySelectorAll('.dropdown-option').item(1);
    click(secondOption);

    expect(handleChange).toHaveBeenCalledWith('beta');
    expect(document.body.querySelector('.dropdown-menu')).toBeNull();
    expect(container.querySelector('.dropdown-value')?.textContent).toBe('Beta');
  });

  it('renders the menu in the body-level overlay layer instead of the trigger layout', async () => {
    const dropdownId = createTestId('portal-dropdown');
    await mount(<Dropdown id={dropdownId} options={OPTIONS} value="" onChange={vi.fn()} />);

    click(container.querySelector('.dropdown-trigger'));

    const menu = document.getElementById(`${dropdownId}-menu`);
    expect(menu).not.toBeNull();
    expect(menu?.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
  });

  it('positions the portaled menu inside the viewport without using trigger layout space', async () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetWidth'
    );
    const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    );

    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get() {
          return this.classList.contains('dropdown-menu')
            ? 240
            : (offsetWidthDescriptor?.get?.call(this) ?? 0);
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get() {
          return this.classList.contains('dropdown-menu')
            ? 180
            : (offsetHeightDescriptor?.get?.call(this) ?? 0);
        },
      });

      await mount(<Dropdown options={OPTIONS} value="" onChange={vi.fn()} />);
      const trigger = requireValue(
        container.querySelector<HTMLElement>('.dropdown-trigger'),
        'expected dropdown trigger'
      );
      trigger.getBoundingClientRect = () =>
        ({
          top: 550,
          bottom: 580,
          height: 30,
          width: 80,
          left: 700,
          right: 780,
          x: 700,
          y: 550,
          toJSON: () => undefined,
        }) as DOMRect;

      click(trigger);

      const menu = requireValue(
        document.body.querySelector<HTMLElement>('.dropdown-menu'),
        'expected portaled dropdown menu'
      );
      expect(menu.style.position).toBe('fixed');
      expect(menu.style.left).toBe('552px');
      expect(menu.style.top).toBe('368px');
      expect(menu.style.getPropertyValue('--dropdown-menu-anchor-width')).toBe('80px');
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalInnerWidth,
      });
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      });
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      }
      if (offsetHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
      }
    }
  });

  it('anchors the portaled menu to the trigger at 80% app zoom', async () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    const originalZoom = document.body.style.zoom;
    const originalZoomFactor = document.documentElement.style.getPropertyValue('--app-zoom-factor');
    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetWidth'
    );
    const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    );

    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
      document.body.style.zoom = '80%';
      document.documentElement.style.setProperty('--app-zoom-factor', '0.8');
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get() {
          return this.classList.contains('dropdown-menu')
            ? 240
            : (offsetWidthDescriptor?.get?.call(this) ?? 0);
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get() {
          return this.classList.contains('dropdown-menu')
            ? 180
            : (offsetHeightDescriptor?.get?.call(this) ?? 0);
        },
      });

      await mount(<Dropdown options={OPTIONS} value="" onChange={vi.fn()} />);
      const trigger = requireValue(
        container.querySelector<HTMLElement>('.dropdown-trigger'),
        'expected dropdown trigger'
      );
      trigger.getBoundingClientRect = () =>
        ({
          top: 440,
          bottom: 464,
          height: 24,
          width: 64,
          left: 560,
          right: 624,
          x: 560,
          y: 440,
          toJSON: () => undefined,
        }) as DOMRect;

      click(trigger);

      const menu = requireValue(
        document.body.querySelector<HTMLElement>('.dropdown-menu'),
        'expected portaled dropdown menu'
      );
      expect(menu.style.left).toBe('700px');
      expect(menu.style.top).toBe('368px');
      expect(menu.style.getPropertyValue('--dropdown-menu-anchor-width')).toBe('80px');
      expect(menu.className).toContain('position-top');
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: originalInnerWidth,
      });
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      });
      document.body.style.zoom = originalZoom;
      if (originalZoomFactor) {
        document.documentElement.style.setProperty('--app-zoom-factor', originalZoomFactor);
      } else {
        document.documentElement.style.removeProperty('--app-zoom-factor');
      }
      if (offsetWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      }
      if (offsetHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
      }
    }
  });

  it('treats pointer interaction inside the portaled menu as inside the dropdown', async () => {
    await mount(<Dropdown options={OPTIONS} value={[]} onChange={vi.fn()} multiple />);

    click(container.querySelector('.dropdown-trigger'));
    const option = document.body.querySelector('.dropdown-option');
    mouseDown(option);

    expect(document.body.querySelector('.dropdown-menu')).not.toBeNull();
    expect(container.querySelector('.dropdown.open')).not.toBeNull();
  });

  it('closes an open sibling dropdown when mousedown bubbling is stopped by a parent', async () => {
    const Harness = () => {
      const [firstValue, setFirstValue] = useState<string[]>([]);
      const [secondValue, setSecondValue] = useState<string[]>([]);
      const formRef = useRef<HTMLFormElement>(null);
      useEffect(() => {
        const form = formRef.current;
        if (!form) {
          return;
        }
        const stopMouseDownPropagation = (event: MouseEvent) => event.stopPropagation();
        form.addEventListener('mousedown', stopMouseDownPropagation);
        return () => form.removeEventListener('mousedown', stopMouseDownPropagation);
      }, []);
      return (
        <form ref={formRef} aria-label="Dropdown propagation harness">
          <Dropdown
            options={OPTIONS}
            value={firstValue}
            onChange={(next) => setFirstValue(next as string[])}
            multiple
            showBulkActions
            renderValue={() => 'First'}
          />
          <Dropdown
            options={OPTIONS}
            value={secondValue}
            onChange={(next) => setSecondValue(next as string[])}
            multiple
            showBulkActions
            renderValue={() => 'Second'}
          />
        </form>
      );
    };

    await mount(<Harness />);

    const triggers = container.querySelectorAll('.dropdown-trigger');
    click(triggers.item(0));
    expect(document.body.querySelectorAll('.dropdown-menu')).toHaveLength(1);

    mouseDown(triggers.item(1));
    click(triggers.item(1));

    expect(document.body.querySelectorAll('.dropdown-menu')).toHaveLength(1);
    expect(container.querySelectorAll('.dropdown.open')).toHaveLength(1);
    expect(container.querySelector('.dropdown.open .dropdown-value')?.textContent).toBe('Second');
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

    const searchInput = document.body.querySelector<HTMLInputElement>('.search-input');
    expect(searchInput).not.toBeNull();

    await setTextInputValue(searchInput, 'gam');

    expect(requireValue(searchInput, 'expected test value in Dropdown.test.tsx').value).toBe('gam');

    const clearButton = container.querySelector<HTMLButtonElement>('.clear-button');
    expect(clearButton).not.toBeNull();
    click(clearButton);

    expect(handleChange).toHaveBeenCalledWith('');
    expect(container.querySelector('.dropdown-value')?.textContent).toBe('Select...');

    // Closing the dropdown should reset the search query
    click(container.querySelector('.dropdown-trigger'));
    click(container.querySelector('.dropdown-trigger'));

    const reopenedInput = document.body.querySelector<HTMLInputElement>('.search-input');
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

    const searchInput = document.body.querySelector<HTMLInputElement>('.search-input');
    expect(searchInput).not.toBeNull();

    await setTextInputValue(searchInput, 'gam');

    const optionLabels = Array.from(document.body.querySelectorAll('.dropdown-option')).map(
      (node) => node.textContent?.trim()
    );
    expect(optionLabels).toEqual(['Gamma']);

    await pressKey(searchInput, 'ArrowDown');
    expect(document.body.querySelector('.dropdown-option.highlighted')?.textContent).toContain(
      'Gamma'
    );

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

    const optionLabels = Array.from(document.body.querySelectorAll('.dropdown-option')).map(
      (node) => node.textContent?.trim()
    );
    expect(optionLabels).toEqual(['Alpha', 'Beta', 'Gamma']);

    const searchInput = document.body.querySelector<HTMLInputElement>('.search-input');
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
    expect(document.body.querySelector('.no-options')?.textContent).toContain(
      'No options available'
    );
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
    const firstHighlighted = document.body.querySelector<HTMLElement>(
      '.dropdown-option.highlighted'
    );
    expect(firstHighlighted?.textContent).toContain('Alpha');
    expect(trigger?.getAttribute('aria-activedescendant')).toBe(firstHighlighted?.id);
    expect(firstHighlighted?.getAttribute('role')).toBe('option');
    expect(firstHighlighted?.getAttribute('aria-selected')).toBe('true');

    await pressKey(trigger, 'ArrowDown');
    const secondHighlighted = document.body.querySelector<HTMLElement>(
      '.dropdown-option.highlighted'
    );
    expect(secondHighlighted?.textContent).toContain('Beta');
    expect(trigger?.getAttribute('aria-activedescendant')).toBe(secondHighlighted?.id);
    expect(firstHighlighted?.getAttribute('aria-selected')).toBe('false');
    expect(secondHighlighted?.getAttribute('aria-selected')).toBe('true');

    await pressKey(trigger, 'Enter');
    expect(handleChange).toHaveBeenCalledWith('beta');
  });

  it('tabs through the list and Only before trailing actions, retaining keyboard row focus on hover', async () => {
    await mount(
      <Dropdown
        options={OPTIONS.map((option) =>
          option.value === 'beta' ? { ...option, disabled: true } : option
        )}
        value={[]}
        multiple
        onChange={vi.fn()}
        renderOptionActions={(option) => (
          <button type="button" data-testid={`action-${option.value}`}>
            Reorder
          </button>
        )}
      />
    );

    const trigger = container.querySelector('.dropdown-trigger');
    click(trigger);
    expect(trigger?.getAttribute('role')).toBeNull();
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
    const dialog = document.body.querySelector('dialog.dropdown-menu');
    expect(dialog).not.toBeNull();
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.getAttribute('role')).toBeNull();
    expect(document.body.querySelector('.dropdown-option')?.getAttribute('role')).toBeNull();
    expect(document.body.querySelector('.dropdown-option')?.getAttribute('aria-pressed')).toBe(
      'false'
    );

    await act(async () => {
      (trigger as HTMLElement).focus();
      await Promise.resolve();
    });
    await pressKey(trigger, 'Tab');
    expect(document.activeElement).toBe(optionIn('Alpha'));
    await pressKey(document.activeElement, 'Tab');
    expect(document.activeElement).toBe(onlyIn('Alpha'));
    await pressKey(document.activeElement, 'Tab');
    expect(document.activeElement).toBe(
      document.body.querySelector('[data-testid="action-alpha"]')
    );

    const firstRow = document.body
      .querySelector('[data-testid="action-alpha"]')
      ?.closest('.dropdown-option-row');
    expect(firstRow?.classList.contains('highlighted')).toBe(true);

    const secondAction = document.body.querySelector('[data-testid="action-beta"]');
    await act(async () => {
      secondAction?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await Promise.resolve();
    });

    const secondRow = secondAction?.closest('.dropdown-option-row');
    expect(firstRow?.classList.contains('highlighted')).toBe(true);
    expect(secondRow?.classList.contains('highlighted')).toBe(false);
    expect(document.activeElement).toBe(
      document.body.querySelector('[data-testid="action-alpha"]')
    );

    await act(async () => {
      (trigger as HTMLElement).focus();
      secondAction?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(secondRow?.classList.contains('highlighted')).toBe(true);
    expect(firstRow?.classList.contains('highlighted')).toBe(false);

    const thirdAction = document.body.querySelector<HTMLElement>('[data-testid="action-gamma"]');
    await act(async () => {
      thirdAction?.focus();
      await Promise.resolve();
    });

    const thirdRow = thirdAction?.closest('.dropdown-option-row');
    expect(thirdRow?.classList.contains('highlighted')).toBe(true);
    expect(secondRow?.classList.contains('highlighted')).toBe(false);
  });

  it.each(['Enter', ' '])('leaves %s on an option action to the focused button', async (key) => {
    const onChange = vi.fn();
    const onAction = vi.fn();
    await mount(
      <Dropdown
        options={OPTIONS}
        value={[]}
        multiple
        onChange={onChange}
        renderOptionActions={(option) => (
          <button type="button" data-testid={`action-${option.value}`} onClick={onAction}>
            Reorder
          </button>
        )}
      />
    );
    const trigger = container.querySelector<HTMLElement>('.dropdown-trigger');
    click(trigger);
    act(() => trigger?.focus());
    await pressKey(trigger, 'Tab');
    expect(document.activeElement).toBe(optionIn('Alpha'));
    await pressKey(document.activeElement, 'Tab');
    expect(document.activeElement).toBe(onlyIn('Alpha'));
    await pressKey(document.activeElement, 'Tab');
    const action = document.body.querySelector<HTMLElement>('[data-testid="action-alpha"]');
    expect(document.activeElement).toBe(action);
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    await act(async () => {
      action?.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    click(action);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it.each(['Enter', ' '])(
    'tabs to bulk actions and leaves %s to the focused button',
    async (key) => {
      const onChange = vi.fn();
      await mount(
        <Dropdown
          options={OPTIONS}
          value={['alpha']}
          multiple
          showBulkActions
          onChange={onChange}
        />
      );
      const trigger = container.querySelector<HTMLElement>('.dropdown-trigger');
      click(trigger);
      act(() => trigger?.focus());
      await pressKey(trigger, 'Tab');
      const action = document.body.querySelector<HTMLElement>('.dropdown-bulk-action');
      expect(document.activeElement).toBe(action);
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      await act(async () => {
        action?.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
      click(action);
      expect(onChange).toHaveBeenCalledWith(['alpha', 'beta', 'gamma']);
    }
  );

  it('retains focus and Tab access when bulk actions become unavailable', async () => {
    const onChange = vi.fn();
    function Controlled() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <Dropdown
          options={OPTIONS}
          value={value}
          multiple
          showBulkActions
          onChange={(next) => {
            onChange(next);
            setValue(next as string[]);
          }}
        />
      );
    }
    await mount(<Controlled />);
    const trigger = container.querySelector<HTMLElement>('.dropdown-trigger');
    click(trigger);
    await pressKey(trigger, 'Tab');
    const all = document.body.querySelector<HTMLElement>('[aria-label="Select all"]');
    click(all);
    expect(document.activeElement).toBe(all);
    expect(all?.getAttribute('aria-disabled')).toBe('true');
    expect(all?.hasAttribute('disabled')).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(['alpha', 'beta', 'gamma']);
    click(all);
    expect(onChange).toHaveBeenCalledTimes(1);
    await pressKey(all, 'Tab');
    const none = document.body.querySelector<HTMLElement>('[aria-label="Select none"]');
    expect(document.activeElement).toBe(none);
    click(none);
    expect(document.activeElement).toBe(none);
    expect(none?.getAttribute('aria-disabled')).toBe('true');
    expect(onChange).toHaveBeenLastCalledWith([]);
    click(none);
    expect(onChange).toHaveBeenCalledTimes(2);
    await pressKey(none, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(all);
  });

  it('restores the trigger when a searchable selection closes its portal', async () => {
    await mount(<Dropdown options={OPTIONS} value="" onChange={vi.fn()} searchable />);
    const trigger = container.querySelector<HTMLElement>('.dropdown-trigger');
    click(trigger);
    const search = document.body.querySelector<HTMLElement>('.search-input');
    await pressKey(search, 'ArrowDown');
    await pressKey(search, 'Enter');
    expect(document.body.querySelector('.dropdown-menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([false, true])(
    'uses one list entry and its Only action before the row actions (searchable=%s)',
    async (searchable) => {
      const onChange = vi.fn();
      await mount(
        <Dropdown
          options={OPTIONS}
          value={[]}
          multiple
          searchable={searchable}
          onChange={onChange}
          renderOptionActions={(option) => (
            <>
              <button type="button" data-testid={`up-${option.value}`}>
                Up
              </button>
              <button type="button" data-testid={`down-${option.value}`}>
                Down
              </button>
            </>
          )}
        />
      );
      const trigger = container.querySelector<HTMLElement>('.dropdown-trigger');
      click(trigger);
      const listOwner = searchable
        ? document.body.querySelector<HTMLElement>('.search-input')
        : trigger;
      act(() => listOwner?.focus());
      await pressKey(listOwner, 'ArrowDown');
      await pressKey(listOwner, searchable ? 'Enter' : ' ');
      expect(onChange).toHaveBeenLastCalledWith(['alpha']);
      expect(document.activeElement).toBe(listOwner);
      await pressKey(listOwner, 'ArrowDown');
      await pressKey(listOwner, 'Enter');
      expect(onChange).toHaveBeenLastCalledWith(['beta']);
      expect(document.activeElement).toBe(listOwner);
      await pressKey(listOwner, 'Tab');
      expect(document.activeElement).toBe(optionIn('Beta'));
      expect(document.querySelectorAll('.dropdown-option[tabindex="0"]')).toHaveLength(1);
      await pressKey(document.activeElement, 'Tab');
      expect(document.activeElement).toBe(onlyIn('Beta'));
      expect(document.querySelectorAll('.dropdown-only-action[tabindex="0"]')).toHaveLength(1);
      await pressKey(document.activeElement, 'Tab');
      const first = document.body.querySelector<HTMLElement>('[data-testid="up-alpha"]');
      const second = document.body.querySelector<HTMLElement>('[data-testid="down-alpha"]');
      const nextRow = document.body.querySelector<HTMLElement>('[data-testid="up-beta"]');
      expect(document.activeElement).toBe(first);
      await pressKey(first, 'Tab');
      expect(document.activeElement).toBe(second);
      await pressKey(second, 'Tab');
      expect(document.activeElement).toBe(nextRow);
      await pressKey(nextRow, 'Tab', { shiftKey: true });
      expect(document.activeElement).toBe(second);
      await pressKey(second, 'Tab', { shiftKey: true });
      expect(document.activeElement).toBe(first);
    }
  );

  it.each([false, true])(
    'wraps Tab inside an action-row dialog (searchable=%s)',
    async (searchable) => {
      await mount(
        <Dropdown
          options={OPTIONS}
          value={[]}
          multiple
          searchable={searchable}
          onChange={vi.fn()}
          renderOptionActions={(option) => (
            <button type="button" data-testid={`action-${option.value}`}>
              Reorder
            </button>
          )}
        />
      );

      const trigger = container.querySelector<HTMLElement>('.dropdown-trigger');
      click(trigger);
      const dialog = requireValue(
        document.querySelector('dialog.dropdown-menu'),
        'dropdown dialog'
      );
      const lastAction = document.querySelector<HTMLElement>('[data-testid="action-gamma"]');
      await act(async () => {
        lastAction?.focus();
        await Promise.resolve();
      });

      const forward = await pressKey(lastAction, 'Tab');
      const firstControl = searchable ? document.querySelector('.search-input') : optionIn('Gamma');
      expect(forward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(firstControl);
      expect(document.body.querySelector('dialog')).toBe(dialog);

      const backward = await pressKey(firstControl, 'Tab', { shiftKey: true });
      expect(backward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(lastAction);
      expect(document.body.querySelector('dialog')).toBe(dialog);

      await pressKey(lastAction, 'Escape');
      expect(document.body.querySelector('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    }
  );

  it('supports keyboard navigation while the search input has focus', async () => {
    await mount(
      <Dropdown options={OPTIONS} value="" onChange={vi.fn()} searchable placeholder="Searchable" />
    );

    click(container.querySelector('.dropdown-trigger'));

    const searchInput = document.body.querySelector<HTMLInputElement>('.search-input');
    expect(searchInput).not.toBeNull();
    searchInput?.focus();

    await pressKey(searchInput, 'ArrowDown');
    const firstHighlighted = document.body.querySelector<HTMLElement>(
      '.dropdown-option.highlighted'
    );
    expect(firstHighlighted?.textContent).toContain('Alpha');
    expect(searchInput?.getAttribute('role')).toBe('combobox');
    expect(searchInput?.getAttribute('aria-controls')).toBe(
      document.body.querySelector<HTMLElement>('[role="listbox"]')?.id
    );
    expect(searchInput?.getAttribute('aria-activedescendant')).toBe(firstHighlighted?.id);

    await pressKey(searchInput, 'ArrowDown');
    const secondHighlighted = document.body.querySelector<HTMLElement>(
      '.dropdown-option.highlighted'
    );
    expect(secondHighlighted?.textContent).toContain('Beta');
    expect(searchInput?.getAttribute('aria-activedescendant')).toBe(secondHighlighted?.id);
  });

  it('removes the trigger highlight while the internal search input is focused', async () => {
    await mount(
      <Dropdown options={OPTIONS} value="" onChange={vi.fn()} searchable placeholder="Searchable" />
    );

    click(container.querySelector('.dropdown-trigger'));

    const dropdown = container.querySelector('.dropdown') as HTMLElement | null;
    const searchInput = document.body.querySelector<HTMLInputElement>('.search-input');
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

  it('cycles Tab between search and a single list entry without closing the popup', async () => {
    await mount(
      <Dropdown options={OPTIONS} value="" onChange={vi.fn()} searchable placeholder="Searchable" />
    );

    click(container.querySelector('.dropdown-trigger'));

    const searchInput = document.body.querySelector<HTMLInputElement>('.search-input');
    expect(searchInput).not.toBeNull();
    searchInput?.focus();

    const menu = requireValue(document.querySelector('.dropdown-menu'), 'dropdown menu');
    const forward = await pressKey(searchInput, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(optionIn('Alpha'));
    await pressKey(document.activeElement, 'Tab');
    expect(document.activeElement).toBe(searchInput);

    const backward = await pressKey(searchInput, 'Tab', { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(optionIn('Alpha'));
    await pressKey(document.activeElement, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(searchInput);
    expect(document.querySelector('.dropdown-menu')).toBe(menu);
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

    const groupHeader = document.body.querySelector('.dropdown-group-header');
    expect(groupHeader?.textContent).toBe('Databases');
    click(groupHeader);
    expect(onChange).not.toHaveBeenCalled();

    const disabledOption = document.body.querySelector('.dropdown-option.disabled');
    expect(disabledOption?.textContent).toBe('Redis');
    click(disabledOption);
    expect(onChange).not.toHaveBeenCalled();

    const mongoOption = document.body.querySelector('[data-testid="option-mongo"]');
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

    const bulkButtons = document.body.querySelectorAll<HTMLButtonElement>('.dropdown-bulk-action');
    expect(bulkButtons).toHaveLength(2);
    expect(bulkButtons[0]?.getAttribute('aria-label')).toBe('Select all');
    expect(bulkButtons[1]?.getAttribute('aria-label')).toBe('Select none');

    click(bulkButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['postgres', 'mongo', 'sqlite']);

    const selectNoneButton =
      document.body.querySelectorAll<HTMLButtonElement>('.dropdown-bulk-action')[1];
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

    const controls = document.body.querySelector('.dropdown-menu-controls');
    expect(controls).not.toBeNull();
    expect(controls?.querySelector('.search-input')).not.toBeNull();
    expect(controls?.querySelectorAll('.dropdown-bulk-action')).toHaveLength(2);
  });

  it('shows text labels beside bulk-action icons when search is disabled', async () => {
    await mount(
      <Dropdown options={OPTIONS} value={[]} onChange={vi.fn()} multiple showBulkActions />
    );

    click(container.querySelector('.dropdown-trigger'));

    const bulkButtons = document.body.querySelectorAll<HTMLButtonElement>('.dropdown-bulk-action');
    expect(bulkButtons).toHaveLength(2);
    expect(bulkButtons[0]?.textContent).toContain('All');
    expect(bulkButtons[1]?.textContent).toContain('None');
    expect(document.body.querySelector('.search-input')).toBeNull();
  });

  it('renders an additional action beside All and None', async () => {
    const onReset = vi.fn();
    await mount(
      <Dropdown
        options={OPTIONS}
        value={[]}
        onChange={vi.fn()}
        multiple
        showBulkActions
        additionalBulkActions={
          <button type="button" aria-label="Extra action" onClick={onReset}>
            Extra
          </button>
        }
      />
    );

    click(container.querySelector('.dropdown-trigger'));
    const reset = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Extra action"]'
    );
    expect(reset?.textContent).toBe('Extra');
    click(reset);
    expect(onReset).toHaveBeenCalledTimes(1);

    // The added action is a different kind of verb from All/None, so it is
    // separated by a real divider. Not the icon-bar spacer, which is
    // deliberately `visibility: hidden` and would render nothing.
    const actions = document.body.querySelector('.dropdown-bulk-actions');
    const divider = actions?.querySelector('.dropdown-bulk-actions-divider');
    expect(divider).not.toBeNull();
    expect(divider?.classList.contains('icon-bar-separator')).toBe(false);
  });

  it('lets a rendered additional bulk action close the dropdown', async () => {
    await mount(
      <Dropdown
        options={OPTIONS}
        value={[]}
        onChange={vi.fn()}
        multiple
        showBulkActions
        additionalBulkActions={({ closeDropdown }) => (
          <button type="button" aria-label="Close from action" onClick={closeDropdown}>
            Close
          </button>
        )}
      />
    );

    click(container.querySelector('.dropdown-trigger'));
    click(document.body.querySelector('button[aria-label="Close from action"]'));

    expect(document.body.querySelector('.dropdown-menu')).toBeNull();
  });

  it('omits the bulk-action separator when there is nothing to separate', async () => {
    await mount(
      <Dropdown options={OPTIONS} value={[]} onChange={vi.fn()} multiple showBulkActions />
    );

    click(container.querySelector('.dropdown-trigger'));
    const actions = document.body.querySelector('.dropdown-bulk-actions');
    expect(actions).not.toBeNull();
    expect(actions?.querySelector('.dropdown-bulk-actions-divider')).toBeNull();
  });

  describe('only action', () => {
    it('collapses the selection to the hovered option', async () => {
      const onChange = vi.fn();
      await mount(
        <Dropdown
          options={OPTIONS}
          value={['alpha', 'beta', 'gamma']}
          onChange={onChange}
          multiple
        />
      );

      click(container.querySelector('.dropdown-trigger'));
      click(onlyIn('Beta'));

      expect(onChange).toHaveBeenCalledWith(['beta']);
    });

    it('leaves the ordinary toggle alone', async () => {
      const onChange = vi.fn();
      await mount(
        <Dropdown options={OPTIONS} value={['alpha', 'beta']} onChange={onChange} multiple />
      );

      click(container.querySelector('.dropdown-trigger'));
      const beta =
        Array.from(document.body.querySelectorAll<HTMLElement>('.dropdown-option')).find((option) =>
          option.textContent?.startsWith('Beta')
        ) ?? null;
      click(beta);

      // Clicking the row body still toggles rather than isolating.
      expect(onChange).toHaveBeenCalledWith(['alpha']);
    });

    it('is inert when the option is already the sole selection', async () => {
      const onChange = vi.fn();
      await mount(<Dropdown options={OPTIONS} value={['beta']} onChange={onChange} multiple />);

      click(container.querySelector('.dropdown-trigger'));
      const only = requireValue(onlyIn('Beta'), 'expected an only action');
      expect(only.getAttribute('aria-disabled')).toBe('true');

      click(only);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('is absent on a disabled option', async () => {
      await mount(
        <Dropdown
          options={OPTIONS.map((option) =>
            option.value === 'beta' ? { ...option, disabled: true } : option
          )}
          value={['alpha']}
          onChange={vi.fn()}
          multiple
        />
      );

      click(container.querySelector('.dropdown-trigger'));
      expect(onlyIn('Beta')).toBeNull();
      expect(onlyIn('Alpha')).not.toBeNull();
    });

    it('is absent for single-select dropdowns', async () => {
      await mount(<Dropdown options={OPTIONS} value="alpha" onChange={vi.fn()} />);

      click(container.querySelector('.dropdown-trigger'));
      expect(document.body.querySelector('.dropdown-only-action')).toBeNull();
    });

    it('can be opted out of', async () => {
      await mount(
        <Dropdown
          options={OPTIONS}
          value={['alpha']}
          onChange={vi.fn()}
          multiple
          enableOnlyAction={false}
        />
      );

      click(container.querySelector('.dropdown-trigger'));
      expect(document.body.querySelector('.dropdown-only-action')).toBeNull();
    });

    it('isolates the highlighted option from the keyboard', async () => {
      const onChange = vi.fn();
      await mount(
        <Dropdown
          options={OPTIONS}
          value={['alpha', 'beta', 'gamma']}
          onChange={onChange}
          multiple
        />
      );

      const trigger = container.querySelector('.dropdown-trigger');
      click(trigger);
      await pressKey(trigger, 'ArrowDown');
      await pressKey(trigger, 'Enter', { altKey: true });

      expect(onChange).toHaveBeenCalledWith(['alpha']);
    });

    it.each(['Enter', ' '])(
      'navigates between Only buttons and leaves %s to activation',
      async (key) => {
        const onChange = vi.fn();
        await mount(
          <Dropdown
            options={[
              OPTIONS[0],
              { value: 'heading', label: 'Unavailable', group: 'header' },
              { ...OPTIONS[1], disabled: true },
              OPTIONS[2],
            ]}
            value={['alpha', 'beta', 'gamma']}
            onChange={onChange}
            multiple
            searchable
            showBulkActions
          />
        );
        const trigger = container.querySelector('.dropdown-trigger');
        click(trigger);
        const search = document.querySelector('.search-input');
        expect(document.activeElement).toBe(search);
        await pressKey(search, 'Tab');
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Select all');
        await pressKey(document.activeElement, 'Tab');
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Select none');
        await pressKey(document.activeElement, 'Tab');
        expect(document.activeElement).toBe(optionIn('Alpha'));
        await pressKey(document.activeElement, 'Tab');
        expect(document.activeElement).toBe(onlyIn('Alpha'));
        expect(onlyIn('Alpha')?.closest('.dropdown-option')).toBeNull();

        for (const [navigationKey, label] of [
          ['ArrowDown', 'Gamma'],
          ['ArrowUp', 'Alpha'],
          ['End', 'Gamma'],
          ['Home', 'Alpha'],
          ['ArrowUp', 'Gamma'],
        ]) {
          const event = await pressKey(document.activeElement, navigationKey);
          expect(event.defaultPrevented).toBe(true);
          expect(document.activeElement).toBe(onlyIn(label));
          expect(optionIn(label).classList.contains('highlighted')).toBe(true);
        }
        expect(onChange).not.toHaveBeenCalled();
        const only = requireValue(onlyIn('Gamma'), 'Only Gamma');
        const activation = await pressKey(only, key);
        expect(activation.defaultPrevented).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
        // jsdom does not perform the browser's default keyboard button click.
        click(only);
        expect(onChange).toHaveBeenCalledExactlyOnceWith(['gamma']);
        expect(document.activeElement).toBe(only);
        await pressKey(only, 'Tab');
        expect(document.activeElement).toBe(search);
        await pressKey(search, 'Tab', { shiftKey: true });
        expect(document.activeElement).toBe(only);
      }
    );
  });

  it('renders labeled bulk-action icons at the compact size', async () => {
    await mount(
      <Dropdown options={OPTIONS} value={[]} onChange={vi.fn()} multiple showBulkActions />
    );

    click(container.querySelector('.dropdown-trigger'));

    // A labeled action pairs the glyph with text, so it takes the smaller size.
    const icon = document.body.querySelector<SVGElement>('.dropdown-bulk-action svg');
    expect(icon).not.toBeNull();
    expect(requireValue(icon, 'expected bulk-action icon').getAttribute('width')).toBe('14');
    expect(requireValue(icon, 'expected bulk-action icon').getAttribute('height')).toBe('14');
  });

  it('gives icon-only bulk actions a slightly larger glyph in the same compact row', async () => {
    await mount(
      <Dropdown
        options={OPTIONS}
        value={[]}
        onChange={vi.fn()}
        multiple
        showBulkActions
        searchable
      />
    );

    click(container.querySelector('.dropdown-trigger'));

    // Nothing but the glyph carries meaning here, so it takes a little more room
    // than a labeled action — but the controls row itself is the same one.
    const icon = document.body.querySelector<SVGElement>('.dropdown-bulk-action svg');
    expect(requireValue(icon, 'expected bulk-action icon').getAttribute('width')).toBe('16');
    expect(document.body.querySelectorAll('.dropdown-menu-controls')).toHaveLength(1);
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

    const menu = document.body.querySelector('.dropdown-menu') as HTMLDivElement | null;
    expect(menu).not.toBeNull();
    if (!menu) {
      return;
    }

    menu.scrollTop = 180;
    await act(async () => {
      menu.dispatchEvent(new Event('scroll'));
      await Promise.resolve();
    });

    const targetOption = document.body.querySelectorAll('.dropdown-option')[25];
    click(targetOption);

    const updatedMenu = document.body.querySelector('.dropdown-menu') as HTMLDivElement | null;
    expect(updatedMenu).not.toBeNull();
    expect(updatedMenu?.scrollTop).toBe(180);
  });

  it.each([false, true])(
    'keeps keyboard navigation usable after an option click (searchable: %s)',
    async (searchable) => {
      const onChange = vi.fn();
      await mount(
        <Dropdown
          options={OPTIONS}
          value={[]}
          onChange={onChange}
          multiple
          searchable={searchable}
        />
      );
      const trigger = container.querySelector('.dropdown-trigger');
      click(trigger);
      const option = optionIn('Alpha');
      click(option);
      expect(onChange).toHaveBeenCalledWith(['alpha']);
      expect(document.activeElement).toBe(searchable ? option : trigger);
      await pressKey(document.activeElement, 'End');
      await pressKey(document.activeElement, 'ArrowUp');
      expect(document.querySelector('.dropdown-option.highlighted')?.textContent).toContain('Beta');
      await pressKey(document.activeElement, 'Enter');
      expect(onChange).toHaveBeenLastCalledWith(['beta']);
      await pressKey(document.activeElement, 'Home');
      await pressKey(document.activeElement, ' ');
      expect(onChange).toHaveBeenLastCalledWith(['alpha']);
      if (searchable) {
        await pressKey(document.activeElement, 'Tab', { shiftKey: true });
        const search = requireValue(
          document.querySelector<HTMLInputElement>('.search-input'),
          'search'
        );
        expect(document.activeElement).toBe(search);
        await setTextInputValue(search, 'Gamma');
        expect(document.querySelectorAll('.dropdown-option')).toHaveLength(1);
        expect(document.querySelector('.dropdown-option')?.textContent).toContain('Gamma');
      }
    }
  );

  it.each([{ value: [] }, { value: ['alpha'] }])(
    'keeps Only focused after isolating selection $value',
    async ({ value }) => {
      const onChange = vi.fn();
      const Controlled = () => {
        const [selection, setSelection] = useState(value);
        return (
          <Dropdown
            options={OPTIONS}
            value={selection}
            onChange={(next) => {
              onChange(next);
              setSelection(next as string[]);
            }}
            multiple
            searchable
          />
        );
      };
      await mount(<Controlled />);
      click(container.querySelector('.dropdown-trigger'));
      const only = requireValue(onlyIn('Alpha'), 'Only Alpha');
      click(only);
      expect(document.activeElement).toBe(only);
      expect(only.getAttribute('aria-disabled')).toBe('true');
      expect(onChange).toHaveBeenCalledTimes(value.length === 0 ? 1 : 0);
      await pressKey(only, 'Tab', { shiftKey: true });
      expect(document.activeElement).toBe(optionIn('Alpha'));
      await pressKey(document.activeElement, 'Tab');
      expect(document.activeElement).toBe(only);
    }
  );

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
        toJSON: () => undefined,
      }),
    });

    click(trigger);

    const menu = document.body.querySelector('.dropdown-menu');
    expect(menu?.className).toContain('position-top');

    if (offsetHeightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
    }
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  it('end-aligns the menu when start alignment would overflow the viewport', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });

    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetWidth'
    );
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        return this.classList.contains('dropdown-menu')
          ? 300
          : (offsetWidthDescriptor?.get?.call(this) ?? 0);
      },
    });

    await mount(<Dropdown options={OPTIONS} value="" onChange={vi.fn()} />);

    const trigger = container.querySelector('.dropdown-trigger') as HTMLElement;
    Object.defineProperty(trigger, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 40,
        bottom: 80,
        height: 40,
        width: 150,
        left: 650,
        right: 800,
        x: 650,
        y: 40,
        toJSON: () => undefined,
      }),
    });

    click(trigger);

    expect(document.body.querySelector('.dropdown-menu')?.className).toContain(
      'position-horizontal-end'
    );

    if (offsetWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
    }
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it('respects loading and disabled states', async () => {
    const handleChange = vi.fn();

    await mount(
      <Dropdown options={OPTIONS} value="" onChange={handleChange} loading placeholder="Pick" />
    );

    expect(container.querySelector('.dropdown-value')?.textContent).toBe('Loading...');
    click(container.querySelector('.dropdown-trigger'));
    expect(document.body.querySelector('.dropdown-menu')).toBeNull();

    await mount(
      <Dropdown options={OPTIONS} value="" onChange={handleChange} disabled placeholder="Pick" />
    );

    click(container.querySelector('.dropdown-trigger'));
    expect(document.body.querySelector('.dropdown-menu')).toBeNull();
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('renders form input values when name is provided', async () => {
    const dropdownId = createTestId('example');
    await mount(
      <Dropdown options={OPTIONS} value="beta" onChange={vi.fn()} name="example" id={dropdownId} />
    );

    const hidden = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="example"]'
    );
    expect(hidden).toBeTruthy();
    expect(hidden?.value).toBe('beta');
    const trigger = container.querySelector('.dropdown-trigger');
    expect(trigger?.getAttribute('aria-controls')).toBe(`${dropdownId}-menu`);
  });
});
