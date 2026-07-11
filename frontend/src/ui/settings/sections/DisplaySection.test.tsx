/**
 * frontend/src/ui/settings/sections/DisplaySection.test.tsx
 *
 * Test suite for DisplaySection.
 */

import { TABLE_PAGE_SIZE_OPTIONS } from '@shared/components/tables/pageSizeOptions';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import DisplaySection from './DisplaySection';

const appPreferenceMocks = vi.hoisted(() => ({
  hydrateAppPreferences: vi.fn(),
  setUseShortResourceNames: vi.fn(),
  setDimInactiveNamespaces: vi.fn(),
  setExclusiveNamespaces: vi.fn(),
  setDefaultTablePageSize: vi.fn(),
}));

vi.mock('@/core/settings/appPreferences', () => ({
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
    appPreferenceMocks.setUseShortResourceNames.mockResolvedValue(undefined);
    appPreferenceMocks.setDimInactiveNamespaces.mockResolvedValue(undefined);
    appPreferenceMocks.setExclusiveNamespaces.mockResolvedValue(undefined);

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

  it('shows the dim inactive namespaces setting on by default', () => {
    expect(container.textContent).toContain('Resources');
    expect(container.textContent).toContain('Sidebar');
    expect(container.textContent).toContain('Exclusive namespaces');
    expect(container.textContent).toContain(
      'When enabled, only one namespace at a time can be expanded in the Sidebar. Expanding a different namespace will collapse the currently expanded one.'
    );
    expect(container.textContent).toContain('Dim inactive namespaces');
    expect(container.textContent).toContain(
      'Dim namespaces in the Sidebar that have no Workloads.'
    );

    expect(container.textContent.indexOf('Dim inactive namespaces')).toBeLessThan(
      container.textContent.indexOf('Exclusive namespaces')
    );

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dim inactive namespaces"]'
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
  });

  it('shows the exclusive namespaces setting on by default', () => {
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Exclusive namespaces"]'
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
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

  it('shows the Tables subsection first with the Default Page Size dropdown', () => {
    expect(container.textContent).toContain('Tables');
    expect(container.textContent).toContain('Default page size');

    // Tables renders FIRST on the page, before Resources.
    expect(container.textContent.indexOf('Tables')).toBeLessThan(
      container.textContent.indexOf('Resources')
    );

    // The dropdown derives its options from the shared page-size list — the
    // same source as every pagination footer.
    const dropdown = requireValue(
      container.querySelector<HTMLSelectElement>('select[aria-label="Default page size"]'),
      'expected the Default page size dropdown'
    );
    const optionValues = Array.from(dropdown.querySelectorAll('option')).map(
      (option) => option.value
    );
    expect(optionValues).toEqual(TABLE_PAGE_SIZE_OPTIONS.map((value) => String(value)));
    expect(dropdown.value).toBe('50');
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
