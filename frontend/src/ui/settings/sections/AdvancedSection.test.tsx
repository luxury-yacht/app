import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import AdvancedSection from './AdvancedSection';

const preferenceMocks = vi.hoisted(() => ({
  hydrateAppPreferences: vi.fn(),
  setKubernetesClientBurst: vi.fn(),
  setKubernetesClientQPS: vi.fn(),
  setPermissionSSRRFetchConcurrency: vi.fn(),
}));

const refreshMocks = vi.hoisted(() => ({
  setAutoRefresh: vi.fn(),
  setBackgroundRefresh: vi.fn(),
}));

const persistenceMocks = vi.hoisted(() => ({
  clearAllGridTableState: vi.fn(),
  setGridTablePersistenceMode: vi.fn(),
}));

const errorHandlerMocks = vi.hoisted(() => ({
  handle: vi.fn(),
}));

const resetMocks = vi.hoisted(() => ({
  clearAccentColor: vi.fn(),
  clearLinkColor: vi.fn(),
  clearTintedPalette: vi.fn(),
  clearAppState: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  useAutoRefresh: () => ({ enabled: true, setAutoRefresh: refreshMocks.setAutoRefresh }),
  useBackgroundRefresh: () => ({
    enabled: true,
    setBackgroundRefresh: refreshMocks.setBackgroundRefresh,
  }),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  commitIntegerPreferenceInput: (_key: string, raw: string, persist: (value: number) => void) => {
    const value = Number(raw);
    persist(value);
    return value;
  },
  getIntegerPreferenceMetadata: () => ({ min: 1, max: 10000 }),
  getKubernetesClientBurst: () => 200,
  getKubernetesClientQPS: () => 100,
  getPermissionSSRRFetchConcurrency: () => 8,
  hydrateAppPreferences: (...args: unknown[]) => preferenceMocks.hydrateAppPreferences(...args),
  setKubernetesClientBurst: (...args: unknown[]) =>
    preferenceMocks.setKubernetesClientBurst(...args),
  setKubernetesClientQPS: (...args: unknown[]) => preferenceMocks.setKubernetesClientQPS(...args),
  setPermissionSSRRFetchConcurrency: (...args: unknown[]) =>
    preferenceMocks.setPermissionSSRRFetchConcurrency(...args),
}));

vi.mock('@shared/components/tables/persistence/gridTablePersistenceReset', () => ({
  clearAllGridTableState: (...args: unknown[]) => persistenceMocks.clearAllGridTableState(...args),
}));

vi.mock('@shared/components/tables/persistence/gridTablePersistenceSettings', () => ({
  getGridTablePersistenceMode: () => 'shared',
  setGridTablePersistenceMode: (...args: unknown[]) =>
    persistenceMocks.setGridTablePersistenceMode(...args),
}));

vi.mock('@utils/accentColor', () => ({ clearAccentColor: resetMocks.clearAccentColor }));
vi.mock('@utils/linkColor', () => ({ clearLinkColor: resetMocks.clearLinkColor }));
vi.mock('@utils/paletteTint', () => ({ clearTintedPalette: resetMocks.clearTintedPalette }));
vi.mock('@utils/errorHandler', () => ({ errorHandler: errorHandlerMocks }));

vi.mock('@core/backend-api', () => ({
  ClearAppState: (...args: unknown[]) => resetMocks.clearAppState(...args),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: ({
    isOpen,
    title,
    onConfirm,
  }: {
    isOpen: boolean;
    title: string;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <div role="dialog">
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

describe('AdvancedSection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    preferenceMocks.hydrateAppPreferences.mockReset();
    preferenceMocks.hydrateAppPreferences.mockResolvedValue({
      kubernetesClientQPS: 100,
      kubernetesClientBurst: 200,
      permissionSSRRFetchConcurrency: 8,
      gridTablePersistenceMode: 'shared',
    });
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
  });

  it('contains advanced controls without Data Management actions', () => {
    const text = container.textContent ?? '';
    expect(text).toContain('Advanced');
    expect(text).toContain('Refresh');
    expect(text).toContain('Kubernetes API');
    expect(text).toContain('Persistence');
    expect(text).toContain('Deletes all preferences and saved state, then reloads the app.');
    expect(text).not.toContain('Data Management');
    expect(text).not.toContain('Export Settings');
    expect(text).not.toContain('Error Reporting');
  });

  it('keeps the refresh, persistence, and reset controls interactive', async () => {
    const refreshSwitch = requireValue(
      container.querySelector<HTMLButtonElement>('[aria-label="Auto-refresh"]'),
      'expected auto-refresh switch'
    );
    const persistenceSwitch = requireValue(
      container.querySelector<HTMLButtonElement>('[aria-label="Per-namespace views"]'),
      'expected persistence switch'
    );
    const backgroundRefreshSwitch = requireValue(
      container.querySelector<HTMLButtonElement>('[aria-label="Background clusters refresh"]'),
      'expected background refresh switch'
    );

    await act(async () => {
      refreshSwitch.click();
      backgroundRefreshSwitch.click();
      persistenceSwitch.click();
      findButton(container, 'Reset Views').click();
    });
    await act(async () => {
      findButton(container, 'Confirm Reset Views').click();
      await Promise.resolve();
    });

    expect(refreshMocks.setAutoRefresh).toHaveBeenCalledWith(false);
    expect(refreshMocks.setBackgroundRefresh).toHaveBeenCalledWith(false);
    expect(persistenceMocks.setGridTablePersistenceMode).toHaveBeenCalledWith('namespaced');
    expect(persistenceMocks.clearAllGridTableState).toHaveBeenCalledOnce();
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent === 'Confirm Reset Views'
      )
    ).toBe(false);
  });

  it('commits edited Kubernetes API preferences on blur', () => {
    const inputs = [
      {
        suffix: 'settings-kubernetes-client-qps',
        value: '321',
        persist: preferenceMocks.setKubernetesClientQPS,
      },
      {
        suffix: 'settings-kubernetes-client-burst',
        value: '654',
        persist: preferenceMocks.setKubernetesClientBurst,
      },
      {
        suffix: 'settings-permission-ssrr-concurrency',
        value: '12',
        persist: preferenceMocks.setPermissionSSRRFetchConcurrency,
      },
    ];

    for (const { suffix, value, persist } of inputs) {
      const input = requireValue(
        container.querySelector<HTMLInputElement>(`[id$="${suffix}"]`),
        `expected ${suffix} input`
      );

      act(() => {
        input.focus();
        input.value = value;
        input.blur();
      });

      expect(input.value).toBe(value);
      expect(persist).toHaveBeenCalledWith(Number(value));
    }
  });

  it('clears app and browser state when factory reset is confirmed', async () => {
    resetMocks.clearAppState.mockResolvedValue(undefined);
    localStorage.setItem('test-setting', 'value');
    sessionStorage.setItem('test-session', 'value');

    await act(async () => {
      findButton(container, 'Factory Reset').click();
    });
    await act(async () => {
      findButton(container, 'Confirm Factory Reset').click();
      await Promise.resolve();
    });

    expect(resetMocks.clearTintedPalette).toHaveBeenCalledOnce();
    expect(resetMocks.clearAccentColor).toHaveBeenCalledOnce();
    expect(resetMocks.clearLinkColor).toHaveBeenCalledOnce();
    expect(resetMocks.clearAppState).toHaveBeenCalledOnce();
    expect(persistenceMocks.clearAllGridTableState).toHaveBeenCalledOnce();
    expect(localStorage.getItem('test-setting')).toBeNull();
    expect(sessionStorage.getItem('test-session')).toBeNull();
  });
});
