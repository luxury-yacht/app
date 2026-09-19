/**
 * frontend/src/ui/settings/sections/DisplaySection.test.tsx
 *
 * Test suite for DisplaySection.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { requireValue } from '@/test-utils/requireValue';
import DisplaySection from './DisplaySection';

const appPreferenceMocks = vi.hoisted(() => ({
  values: {
    useShortResourceNames: false,
    dimInactiveNamespaces: true,
    exclusiveNamespaces: true,
    defaultTablePageSize: 50,
  },
  hydrateAppPreferences: vi.fn(),
  setUseShortResourceNames: vi.fn(),
  setDimInactiveNamespaces: vi.fn(),
  setExclusiveNamespaces: vi.fn(),
  setDefaultTablePageSize: vi.fn(),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getUseShortResourceNames: () => appPreferenceMocks.values.useShortResourceNames,
  getDimInactiveNamespaces: () => appPreferenceMocks.values.dimInactiveNamespaces,
  getExclusiveNamespaces: () => appPreferenceMocks.values.exclusiveNamespaces,
  getDefaultTablePageSize: () => appPreferenceMocks.values.defaultTablePageSize,
  hydrateAppPreferences: (...args: unknown[]) => appPreferenceMocks.hydrateAppPreferences(...args),
  setUseShortResourceNames: (...args: unknown[]) =>
    appPreferenceMocks.setUseShortResourceNames(...args),
  setDimInactiveNamespaces: (...args: unknown[]) =>
    appPreferenceMocks.setDimInactiveNamespaces(...args),
  setExclusiveNamespaces: (...args: unknown[]) =>
    appPreferenceMocks.setExclusiveNamespaces(...args),
  setDefaultTablePageSize: (...args: unknown[]) =>
    appPreferenceMocks.setDefaultTablePageSize(...args),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: {
    handle: vi.fn(),
  },
}));

// Render the shared Dropdown as a native select so options and changes are
// directly assertable without driving the custom popup.
vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    value = '',
    onChange,
    options = [],
    ariaLabel,
  }: {
    value?: string;
    onChange?: (value: string) => void;
    options?: Array<{ value: string; label: string }>;
    ariaLabel?: string;
  }) => (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe('DisplaySection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    appPreferenceMocks.values = {
      useShortResourceNames: false,
      dimInactiveNamespaces: true,
      exclusiveNamespaces: true,
      defaultTablePageSize: 50,
    };
    appPreferenceMocks.hydrateAppPreferences.mockReset();
    appPreferenceMocks.setUseShortResourceNames.mockReset();
    appPreferenceMocks.setDimInactiveNamespaces.mockReset();
    appPreferenceMocks.setExclusiveNamespaces.mockReset();
    appPreferenceMocks.hydrateAppPreferences.mockResolvedValue({
      useShortResourceNames: false,
      dimInactiveNamespaces: true,
      exclusiveNamespaces: true,
      defaultTablePageSize: 50,
    });
    appPreferenceMocks.setUseShortResourceNames.mockImplementation(async (value: boolean) => {
      appPreferenceMocks.values.useShortResourceNames = value;
      eventBus.emit('settings:short-names', value);
    });
    appPreferenceMocks.setDimInactiveNamespaces.mockImplementation(async (value: boolean) => {
      appPreferenceMocks.values.dimInactiveNamespaces = value;
      eventBus.emit('settings:dim-inactive-namespaces', value);
    });
    appPreferenceMocks.setExclusiveNamespaces.mockImplementation(async (value: boolean) => {
      appPreferenceMocks.values.exclusiveNamespaces = value;
      eventBus.emit('settings:exclusive-namespaces', value);
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<DisplaySection />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
  });

  it('restores the displayed preference when a toggle fails to persist', async () => {
    appPreferenceMocks.setUseShortResourceNames.mockRejectedValueOnce(
      new Error('persistence failed')
    );
    const toggle = requireValue(
      container.querySelector<HTMLButtonElement>('button[aria-label="Short resource names"]'),
      'expected short-name toggle'
    );
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await act(async () => toggle.click());
    expect(appPreferenceMocks.setUseShortResourceNames).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('persists exclusive namespaces changes', async () => {
    const toggle = requireValue(
      container.querySelector<HTMLButtonElement>('button[aria-label="Exclusive namespaces"]'),
      'expected the Exclusive namespaces toggle'
    );

    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });

    expect(appPreferenceMocks.setExclusiveNamespaces).toHaveBeenCalledWith(false);
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
  });

  it('persists default page size changes', async () => {
    const dropdown = requireValue(
      container.querySelector<HTMLSelectElement>('select[aria-label="Default page size"]'),
      'expected the Default page size dropdown'
    );

    await act(async () => {
      dropdown.value = '250';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(appPreferenceMocks.setDefaultTablePageSize).toHaveBeenCalledWith(250);
  });

  it('persists dim inactive namespaces changes', async () => {
    const toggle = requireValue(
      container.querySelector<HTMLButtonElement>('button[aria-label="Dim inactive namespaces"]'),
      'expected the Dim inactive namespaces toggle'
    );

    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });

    expect(appPreferenceMocks.setDimInactiveNamespaces).toHaveBeenCalledWith(false);
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
  });
});
