/**
 * frontend/src/ui/settings/sections/DisplaySection.test.tsx
 *
 * Test suite for DisplaySection.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import DisplaySection from './DisplaySection';

const appPreferenceMocks = vi.hoisted(() => ({
  hydrateAppPreferences: vi.fn(),
  setUseShortResourceNames: vi.fn(),
  setDimInactiveNamespaces: vi.fn(),
  setExclusiveNamespaces: vi.fn(),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  hydrateAppPreferences: (...args: unknown[]) => appPreferenceMocks.hydrateAppPreferences(...args),
  setUseShortResourceNames: (...args: unknown[]) =>
    appPreferenceMocks.setUseShortResourceNames(...args),
  setDimInactiveNamespaces: (...args: unknown[]) =>
    appPreferenceMocks.setDimInactiveNamespaces(...args),
  setExclusiveNamespaces: (...args: unknown[]) =>
    appPreferenceMocks.setExclusiveNamespaces(...args),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: {
    handle: vi.fn(),
  },
}));

describe('DisplaySection', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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
      'When enabled, only one namespace at a time can be expanded in the Sidebar.'
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
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Exclusive namespaces"]'
    );
    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle!.click();
      await Promise.resolve();
    });

    expect(appPreferenceMocks.setExclusiveNamespaces).toHaveBeenCalledWith(false);
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
  });

  it('persists dim inactive namespaces changes', async () => {
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dim inactive namespaces"]'
    );
    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle!.click();
      await Promise.resolve();
    });

    expect(appPreferenceMocks.setDimInactiveNamespaces).toHaveBeenCalledWith(false);
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
  });
});
