import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import AdvancedSection from './AdvancedSection';

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

vi.mock('@/core/refresh', () => ({
  useAutoRefresh: () => ({ enabled: true, setAutoRefresh: vi.fn() }),
  useBackgroundRefresh: () => ({ enabled: true, setBackgroundRefresh: vi.fn() }),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  commitIntegerPreferenceInput: (_key: string, raw: string, persist: (value: number) => void) => {
    const value = Number(raw);
    persist(value);
    return value;
  },
  getIntegerPreferenceMetadata: () => ({ min: 1, max: 10000 }),
  getErrorReportingEnabled: () => false,
  getKubernetesClientBurst: () => 200,
  getKubernetesClientQPS: () => 100,
  getPermissionSSRRFetchConcurrency: () => 8,
  hydrateAppPreferences: (...args: unknown[]) => preferenceMocks.hydrateAppPreferences(...args),
  setErrorReportingEnabled: (...args: unknown[]) =>
    preferenceMocks.setErrorReportingEnabled(...args),
  setKubernetesClientBurst: vi.fn(),
  setKubernetesClientQPS: vi.fn(),
  setPermissionSSRRFetchConcurrency: vi.fn(),
}));

vi.mock('@shared/components/tables/persistence/gridTablePersistenceReset', () => ({
  clearAllGridTableState: vi.fn(),
}));

vi.mock('@shared/components/tables/persistence/gridTablePersistenceSettings', () => ({
  getGridTablePersistenceMode: () => 'shared',
  setGridTablePersistenceMode: vi.fn(),
}));

vi.mock('@utils/accentColor', () => ({ clearAccentColor: vi.fn() }));
vi.mock('@utils/linkColor', () => ({ clearLinkColor: vi.fn() }));
vi.mock('@utils/paletteTint', () => ({ clearTintedPalette: vi.fn() }));
vi.mock('@utils/errorHandler', () => ({ errorHandler: errorHandlerMocks }));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: ({
    isOpen,
    title,
    message,
    onConfirm,
  }: {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <div role="dialog">
        <span>{message}</span>
        <button type="button" aria-label={`Confirm ${title}`} onClick={onConfirm}>
          Confirm {title}
        </button>
      </div>
    ) : null,
}));

const findButton = (container: HTMLElement, label: string): HTMLButtonElement =>
  requireValue(
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label),
    `expected ${label} button`
  );

describe('AdvancedSection data management', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    preferenceMocks.hydrateAppPreferences.mockReset();
    preferenceMocks.setErrorReportingEnabled.mockReset();
    preferenceMocks.setErrorReportingEnabled.mockResolvedValue(undefined);
    preferenceMocks.hydrateAppPreferences.mockResolvedValue({
      kubernetesClientQPS: 100,
      kubernetesClientBurst: 200,
      permissionSSRRFetchConcurrency: 8,
      gridTablePersistenceMode: 'shared',
      errorReportingEnabled: false,
    });
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
      root.render(<AdvancedSection />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('places Data Management immediately after the warning and before Refresh', () => {
    const text = container.textContent ?? '';
    expect(text).toContain('Data Management');
    expect(text.indexOf('Modifying these settings')).toBeLessThan(text.indexOf('Data Management'));
    expect(text.indexOf('Data Management')).toBeLessThan(text.indexOf('Refresh'));
    expect(findButton(container, 'Export Settings')).toBeTruthy();
    expect(findButton(container, 'Import Settings')).toBeTruthy();
    expect(findButton(container, 'Export Favorites')).toBeTruthy();
    expect(findButton(container, 'Import Favorites')).toBeTruthy();
  });

  it('shows the exact Error Reporting explainer and persists the toggle', async () => {
    const text = container.textContent ?? '';
    expect(text).toContain('Error Reporting');
    expect(text).toContain(
      'Sends helpful data when an error occurs that I use to improve the app. It is completely anonymous and cannot be used to identify you. Toggle it off if you do not wish to participate.'
    );
    expect(text.indexOf('Data Management')).toBeLessThan(text.indexOf('Error Reporting'));
    expect(text.indexOf('Error Reporting')).toBeLessThan(text.indexOf('Refresh'));

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
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('imports favorites directly and refreshes subscribers', async () => {
    await act(async () => {
      findButton(container, 'Import Favorites').click();
      await Promise.resolve();
    });

    expect(backendMocks.ImportFavorites).toHaveBeenCalledOnce();
    expect(favoritesMocks.hydrateFavorites).toHaveBeenCalledWith({ force: true });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Favorites imported.');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
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

  it('keeps the existing refresh, persistence, and reset controls interactive', async () => {
    const refreshSwitch = requireValue(
      container.querySelector<HTMLButtonElement>('[aria-label="Auto-refresh"]'),
      'expected auto-refresh switch'
    );
    const persistenceSwitch = requireValue(
      container.querySelector<HTMLButtonElement>('[aria-label="Per-namespace views"]'),
      'expected persistence switch'
    );

    await act(async () => {
      refreshSwitch.click();
      persistenceSwitch.click();
      findButton(container, 'Reset Views').click();
    });
    await act(async () => {
      findButton(container, 'Confirm Reset Views').click();
      await Promise.resolve();
    });

    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent === 'Confirm Reset Views'
      )
    ).toBe(false);
  });

  it('commits an edited Kubernetes API preference on blur', () => {
    const input = requireValue(
      container.querySelector<HTMLInputElement>('[id$="settings-kubernetes-client-qps"]'),
      'expected client QPS input'
    );

    act(() => {
      input.focus();
      input.value = '321';
      input.blur();
    });

    expect(input.value).toBe('321');
  });
});
