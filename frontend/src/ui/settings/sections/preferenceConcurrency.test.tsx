import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hydrateAppPreferences,
  resetAppPreferencesCacheForTesting,
} from '@/core/settings/appPreferences';
import { requireValue } from '@/test-utils/requireValue';
import DataManagementSection from './DataManagementSection';
import DisplaySection from './DisplaySection';

const backend = vi.hoisted(() => ({
  GetAppSettings: vi.fn(),
  GetAppSettingsSchema: vi.fn(),
  UpdateAppPreferences: vi.fn(),
  ExportSettings: vi.fn(),
  ImportSettings: vi.fn(),
  ExportFavorites: vi.fn(),
  ImportFavorites: vi.fn(),
}));
vi.mock('@/core/backend-api', () => backend);
vi.mock('@/core/persistence/favorites', () => ({ hydrateFavorites: vi.fn() }));
vi.mock('@/core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => true,
  emitBroadcastEvent: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/core/telemetry/sentry', () => ({
  captureBootstrapError: vi.fn(),
  captureUserVisibleError: vi.fn(),
  recordBrokerRequestCompleted: vi.fn(),
  recordBrokerRequestStarted: vi.fn(),
}));
vi.mock('@/utils/errorHandler', () => ({
  errorHandler: { handle: vi.fn() },
  reportOperationalError: vi.fn(),
}));
vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    value,
    onChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    ariaLabel: string;
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const pendingSave = () => {
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((_resolve, rejectSave) => {
    reject = rejectSave;
  });
  return { promise, reject };
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('settings controls with the preference owner', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  beforeEach(async () => {
    resetAppPreferencesCacheForTesting();
    backend.GetAppSettingsSchema.mockResolvedValue(null);
    backend.GetAppSettings.mockResolvedValue({
      useShortResourceNames: false,
      errorReportingEnabled: false,
      defaultTablePageSize: 50,
    });
    backend.UpdateAppPreferences.mockReset().mockResolvedValue({});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(
        <>
          <DisplaySection />
          <DataManagementSection />
        </>
      );
      await flush();
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(['Short resource names', 'Error Reporting'])(
    'shows confirmed %s state after two overlapping toggles both fail',
    async (label) => {
      const toggle = requireValue(
        container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
        'expected preference toggle'
      );
      const first = pendingSave();
      const second = pendingSave();
      backend.UpdateAppPreferences.mockReturnValueOnce(first.promise).mockReturnValueOnce(
        second.promise
      );
      await act(async () => toggle.click());
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      await act(async () => toggle.click());
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      await act(async () => {
        first.reject(new Error('first save failed'));
        await flush();
      });
      await act(async () => {
        second.reject(new Error('second save failed'));
        await flush();
      });
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    }
  );

  it('updates mounted controls after another window changes preferences', async () => {
    backend.GetAppSettings.mockResolvedValue({
      useShortResourceNames: true,
      errorReportingEnabled: true,
      defaultTablePageSize: 250,
    });
    await act(async () => {
      await hydrateAppPreferences({ force: true });
    });
    for (const label of ['Short resource names', 'Error Reporting']) {
      expect(
        container.querySelector(`button[aria-label="${label}"]`)?.getAttribute('aria-checked')
      ).toBe('true');
    }
    expect(
      container.querySelector<HTMLSelectElement>('select[aria-label="Default page size"]')?.value
    ).toBe('250');
  });

  it('restores the displayed page size when persistence fails', async () => {
    backend.UpdateAppPreferences.mockRejectedValueOnce(new Error('save failed'));
    const select = requireValue(
      container.querySelector<HTMLSelectElement>('select[aria-label="Default page size"]'),
      'expected page size'
    );
    await act(async () => {
      select.value = '100';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    expect(select.value).toBe('50');
  });
});
