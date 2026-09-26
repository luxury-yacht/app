/**
 * frontend/src/ui/shortcuts/components/ShortcutHelpModal.test.tsx
 *
 * Test suite for ShortcutHelpModal.
 * Renders the modal inside a real KeyboardProvider with real registrations so
 * category navigation, filtering, and key routing use the production paths.
 */

import { act, useMemo } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import type { ShortcutModifiers } from '@/types/shortcuts';
import { KeyboardProvider } from '../context';
import { useShortcuts } from '../hooks';
import { ShortcutHelpModal } from './ShortcutHelpModal';

vi.mock('@core/desktop-runtime', () => ({
  onEvent: () => () => undefined,
  desktopRuntimeAvailable: () => false,
}));

type Registration = {
  key: string;
  description: string;
  category: string;
  helpOrder?: number;
  modifiers?: ShortcutModifiers;
};

const REGISTRATIONS: Registration[] = [
  { key: 'Tab', description: 'Next control in region', category: 'Navigation', helpOrder: 10 },
  {
    key: 'Tab',
    modifiers: { shift: true },
    description: 'Previous control in region',
    category: 'Navigation',
    helpOrder: 11,
  },
  { key: 'ArrowDown', description: 'Select next row', category: 'Tables', helpOrder: 10 },
  { key: 'Enter', description: 'Open focused row', category: 'Tables', helpOrder: 50 },
  { key: ' ', description: 'Open focused row', category: 'Tables', helpOrder: 51 },
  {
    key: '?',
    modifiers: { shift: true },
    description: 'Show keyboard shortcuts help',
    category: 'Settings & Tools',
    helpOrder: 20,
  },
  {
    key: 'p',
    modifiers: { shift: true },
    description: 'An explicit Shift shortcut',
    category: 'Settings & Tools',
    helpOrder: 30,
  },
];

const selectNextRow = vi.fn(() => true);

const Registrations = () => {
  const shortcuts = useMemo(
    () =>
      REGISTRATIONS.map((registration) => ({
        ...registration,
        handler: registration.key === 'ArrowDown' ? selectNextRow : () => false,
      })),
    []
  );
  useShortcuts(shortcuts);
  return null;
};

describe('ShortcutHelpModal', () => {
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
    vi.useRealTimers();
  });

  const renderModal = async (isOpen: boolean, onClose: () => void = vi.fn()) => {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Registrations />
          <ShortcutHelpModal isOpen={isOpen} onClose={onClose} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
  };

  const categoryButtons = () =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Shortcut categories"] button')
    );
  const category = (label: string) =>
    requireValue(
      categoryButtons().find((button) => button.querySelector('span')?.textContent === label),
      `expected ${label} category`
    );
  const visibleCategories = () =>
    Array.from(document.querySelectorAll('.shortcut-group h3'), (heading) => heading.textContent);
  const visibleActions = () =>
    Array.from(document.querySelectorAll('.shortcut-description'), (row) => row.textContent);
  const actionRow = (description: string) =>
    requireValue(
      Array.from(document.querySelectorAll<HTMLElement>('.shortcut-item')).find(
        (row) => row.querySelector('.shortcut-description')?.textContent === description
      ),
      `expected ${description} row`
    );
  const filterInput = () =>
    requireValue(
      document.querySelector<HTMLInputElement>('input[type="search"]'),
      'expected shortcut filter'
    );
  const typeFilter = async (value: string) => {
    const input = filterInput();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const press = async (key: string, target: Element | null = document.activeElement) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    await act(async () => {
      target?.dispatchEvent(event);
    });
    return event;
  };

  it('counts actions per category and shows only the chosen category', async () => {
    await renderModal(true);

    expect(
      categoryButtons().map((button) =>
        Array.from(button.querySelectorAll('span'), (part) => part.textContent)
      )
    ).toEqual([
      ['All', '7'],
      ['Navigation', '2'],
      ['Search', '1'],
      ['Tables', '2'],
      ['Settings & Tools', '2'],
    ]);
    expect(visibleCategories()).toEqual(['Navigation', 'Search', 'Tables', 'Settings & Tools']);
    expect(visibleActions().slice(0, 2)).toEqual([
      'Next control in region',
      'Previous control in region',
    ]);

    await act(async () => category('Tables').click());
    expect(visibleCategories()).toEqual(['Tables']);
    expect(visibleActions()).toEqual(['Select next row', 'Open focused row']);
    expect(category('Tables').getAttribute('aria-current')).toBe('page');
    expect(category('All').getAttribute('aria-current')).toBeNull();

    await act(async () => category('All').click());
    expect(visibleCategories()).toHaveLength(4);
  });

  it('filters actions by name within the chosen category and reports no matches', async () => {
    await renderModal(true);

    await typeFilter('NEXT');
    expect(visibleActions()).toEqual(['Next control in region', 'Select next row']);

    await act(async () => category('Tables').click());
    expect(visibleActions()).toEqual(['Select next row']);

    await typeFilter('zzz');
    expect(visibleActions()).toEqual([]);
    expect(document.querySelector('.shortcut-help-results')?.textContent).toContain('zzz');
  });

  it('labels every binding of a merged action, including Space', async () => {
    await renderModal(true);

    expect(
      Array.from(actionRow('Open focused row').querySelectorAll('kbd'), (key) => key.textContent)
    ).toEqual(['Enter', 'Space']);
    // The question mark already represents the shifted key; other Shift shortcuts show it.
    expect(actionRow('Show keyboard shortcuts help').querySelectorAll('kbd')).toHaveLength(1);
    expect(actionRow('An explicit Shift shortcut').querySelectorAll('kbd')).toHaveLength(2);
  });

  it('types ? and / into the filter but closes on them elsewhere', async () => {
    const onClose = vi.fn();
    await renderModal(true, onClose);

    const input = filterInput();
    act(() => input.focus());
    expect((await press('?')).defaultPrevented).toBe(false);
    expect((await press('/')).defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    act(() => category('All').focus());
    await press('?');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves between categories with arrow keys from a single Tab stop', async () => {
    await renderModal(true);

    expect(categoryButtons().filter((button) => button.tabIndex === 0)).toEqual([category('All')]);
    act(() => category('All').focus());
    await press('ArrowDown');
    expect(document.activeElement).toBe(category('Navigation'));
    expect(category('All').getAttribute('aria-current')).toBe('page');
    await press('End');
    expect(document.activeElement).toBe(category('Settings & Tools'));
  });

  it('starts every opening with all categories and an empty filter', async () => {
    await renderModal(true);
    await act(async () => category('Tables').click());
    await typeFilter('row');

    await renderModal(false);
    await renderModal(true);

    expect(filterInput().value).toBe('');
    expect(category('All').getAttribute('aria-current')).toBe('page');
    expect(visibleCategories()).toHaveLength(4);
  });

  it('keeps background shortcuts from running while open', async () => {
    selectNextRow.mockClear();
    await renderModal(true);

    await press('ArrowDown', document.querySelector('.modal-close'));

    expect(selectNextRow).not.toHaveBeenCalled();
  });

  it('closes on Escape, including from the filter', async () => {
    const onClose = vi.fn();
    await renderModal(true, onClose);

    act(() => filterInput().focus());
    await press('Escape');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on overlay click but not on clicks inside the dialog', async () => {
    const onClose = vi.fn();
    await renderModal(true, onClose);

    const modal = requireValue(document.querySelector('.shortcut-help-modal'), 'modal');
    expect(modal.getAttribute('role')).toBe('dialog');
    act(() => {
      modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      requireValue(
        document.querySelector<HTMLButtonElement>('.modal-backdrop-dismiss'),
        'backdrop'
      ).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('plays the closing animation before unmounting', async () => {
    vi.useFakeTimers();
    await renderModal(true);
    await renderModal(false);

    const overlay = document.querySelector('.shortcut-help-modal-overlay');
    expect(overlay?.className).toContain('closing');

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(document.querySelector('.shortcut-help-modal-overlay')).toBeNull();
  });
});
