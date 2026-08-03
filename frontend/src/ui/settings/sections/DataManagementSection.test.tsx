import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import DataManagementSection from './DataManagementSection';

const backendMocks = vi.hoisted(() => ({
  ExportSettings: vi.fn(),
  ImportSettings: vi.fn(),
  ExportFavorites: vi.fn(),
  ImportFavorites: vi.fn(),
}));

const preferenceMocks = vi.hoisted(() => ({
  hydrateAppPreferences: vi.fn(),
  setErrorReportingEnabled: vi.fn(),
}));

const favoritesMocks = vi.hoisted(() => ({
  hydrateFavorites: vi.fn(),
}));

const errorHandlerMocks = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('@/core/backend-api', () => backendMocks);
vi.mock('@/core/persistence/favorites', () => ({
  hydrateFavorites: (...args: unknown[]) => favoritesMocks.hydrateFavorites(...args),
}));
vi.mock('@/core/settings/appPreferences', () => ({
  getErrorReportingEnabled: () => false,
  hydrateAppPreferences: (...args: unknown[]) => preferenceMocks.hydrateAppPreferences(...args),
  setErrorReportingEnabled: (...args: unknown[]) =>
    preferenceMocks.setErrorReportingEnabled(...args),
}));
vi.mock('@utils/errorHandler', () => ({ errorHandler: errorHandlerMocks }));

const findButton = (container: HTMLElement, label: string): HTMLButtonElement =>
  requireValue(
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label),
    `expected ${label} button`
  );

describe('DataManagementSection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    preferenceMocks.hydrateAppPreferences.mockReset();
    preferenceMocks.hydrateAppPreferences.mockResolvedValue({ errorReportingEnabled: false });
    preferenceMocks.setErrorReportingEnabled.mockReset();
    preferenceMocks.setErrorReportingEnabled.mockResolvedValue(undefined);
    favoritesMocks.hydrateFavorites.mockReset();
    favoritesMocks.hydrateFavorites.mockResolvedValue([]);
    errorHandlerMocks.handle.mockReset();
    for (const mock of Object.values(backendMocks)) {
      mock.mockReset();
      mock.mockResolvedValue({ canceled: false, path: '/tmp/export.json' });
    }

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<DataManagementSection />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('contains the data transfer actions and Error Reporting preference', () => {
    expect(container.textContent).toContain('Data Management');
    expect(container.textContent).toContain('Export Settings');
    expect(container.textContent).toContain('Import Settings');
    expect(container.textContent).toContain('Export Favorites');
    expect(container.textContent).toContain('Import Favorites');
    expect(container.textContent).toContain('Error Reporting');
    expect(container.textContent).toContain(
      'Sends anonymous installation and app-launch counts, errors, release health, and diagnostic data to Sentry that I use to improve the app. A random installation ID is stored on this device and sent as the Sentry user ID. Reports may also include cluster and resource names, request details, device information, and IP addresses. Toggle it off if you do not wish to participate.'
    );
  });

  it('groups transfer controls under Export and Import and reporting under Telemetry', () => {
    const subsectionLabels = Array.from(
      container.querySelectorAll<HTMLElement>('.settings-subgroup-label')
    ).map((label) => label.textContent);
    const text = container.textContent ?? '';

    expect(subsectionLabels).toEqual(['Export and Import', 'Telemetry']);
    expect(text.indexOf('Export and Import')).toBeLessThan(text.indexOf('Settings'));
    expect(text.indexOf('Favorites')).toBeLessThan(text.indexOf('Telemetry'));
    expect(text.indexOf('Telemetry')).toBeLessThan(text.indexOf('Error Reporting'));
  });

  it('persists the Error Reporting toggle', async () => {
    const toggle = requireValue(
      container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Error Reporting"]'),
      'expected Error Reporting toggle'
    );
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });

    expect(preferenceMocks.setErrorReportingEnabled).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('exports settings and reports success', async () => {
    await act(async () => {
      findButton(container, 'Export Settings').click();
      await Promise.resolve();
    });

    expect(backendMocks.ExportSettings).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Settings exported.');
  });

  it('exports favorites and reports success', async () => {
    await act(async () => {
      findButton(container, 'Export Favorites').click();
      await Promise.resolve();
    });

    expect(backendMocks.ExportFavorites).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Favorites exported.');
  });

  it('imports settings directly and rehydrates preferences', async () => {
    await act(async () => {
      findButton(container, 'Import Settings').click();
      await Promise.resolve();
    });

    expect(backendMocks.ImportSettings).toHaveBeenCalledOnce();
    expect(preferenceMocks.hydrateAppPreferences).toHaveBeenLastCalledWith({ force: true });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Settings imported.');
  });

  it('imports favorites directly and refreshes subscribers', async () => {
    await act(async () => {
      findButton(container, 'Import Favorites').click();
      await Promise.resolve();
    });

    expect(backendMocks.ImportFavorites).toHaveBeenCalledOnce();
    expect(favoritesMocks.hydrateFavorites).toHaveBeenCalledWith({ force: true });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Favorites imported.');
  });

  it('does not report a canceled export as success', async () => {
    backendMocks.ExportFavorites.mockResolvedValueOnce({ canceled: true, path: '' });

    await act(async () => {
      findButton(container, 'Export Favorites').click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(errorHandlerMocks.handle).not.toHaveBeenCalled();
  });

  it('does not rehydrate after a canceled settings import', async () => {
    backendMocks.ImportSettings.mockResolvedValueOnce({ canceled: true, path: '' });

    await act(async () => {
      findButton(container, 'Import Settings').click();
      await Promise.resolve();
    });

    expect(preferenceMocks.hydrateAppPreferences).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('does not rehydrate after a canceled favorites import', async () => {
    backendMocks.ImportFavorites.mockResolvedValueOnce({ canceled: true, path: '' });

    await act(async () => {
      findButton(container, 'Import Favorites').click();
      await Promise.resolve();
    });

    expect(favoritesMocks.hydrateFavorites).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('routes export errors through the shared error handler', async () => {
    const error = new Error('export failed');
    backendMocks.ExportSettings.mockRejectedValueOnce(error);

    await act(async () => {
      findButton(container, 'Export Settings').click();
      await Promise.resolve();
    });

    expect(errorHandlerMocks.handle).toHaveBeenCalledWith(error, { action: 'exportSettings' });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('routes favorites export errors through the shared error handler', async () => {
    const error = new Error('favorites export failed');
    backendMocks.ExportFavorites.mockRejectedValueOnce(error);

    await act(async () => {
      findButton(container, 'Export Favorites').click();
      await Promise.resolve();
    });

    expect(errorHandlerMocks.handle).toHaveBeenCalledWith(error, { action: 'exportFavorites' });
  });

  it('routes import errors through the shared error handler', async () => {
    const error = new Error('import failed');
    backendMocks.ImportFavorites.mockRejectedValueOnce(error);

    await act(async () => {
      findButton(container, 'Import Favorites').click();
      await Promise.resolve();
    });

    expect(errorHandlerMocks.handle).toHaveBeenCalledWith(error, { action: 'importFavorites' });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('routes settings import errors through the shared error handler', async () => {
    const error = new Error('settings import failed');
    backendMocks.ImportSettings.mockRejectedValueOnce(error);

    await act(async () => {
      findButton(container, 'Import Settings').click();
      await Promise.resolve();
    });

    expect(errorHandlerMocks.handle).toHaveBeenCalledWith(error, { action: 'importSettings' });
  });
});
