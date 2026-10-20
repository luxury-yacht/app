/**
 * frontend/src/ui/settings/sections/LogsSection.test.tsx
 *
 * The Logs settings persist through the preference owner and follow it,
 * including when a failed write rolls a value back.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AppPreferenceKey,
  type AppPreferences,
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { controlName } from '@/test-utils/controlName';
import { requireValue } from '@/test-utils/requireValue';
import LogsSection from './LogsSection';

const prefs = vi.hoisted(() => ({
  setBufferSize: vi.fn(),
  setPerScopeLimit: vi.fn(),
  setGlobalLimit: vi.fn(),
  setUseLocalTimeZone: vi.fn(),
  setTimestampFormat: vi.fn(),
}));

// The real preference store; the setters update it as the optimistic setters do,
// without a backend.
vi.mock('@/core/settings/appPreferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/settings/appPreferences')>();
  const owner =
    <K extends AppPreferenceKey>(key: K, record: (value: AppPreferences[K]) => void) =>
    (value: AppPreferences[K]) => {
      record(value);
      actual.setAppPreferencesForTesting({ [key]: value });
    };
  return {
    ...actual,
    commitIntegerPreferenceInput: (_key: string, raw: string, persist: (value: number) => void) => {
      const value = Number(raw);
      persist(value);
      return value;
    },
    getIntegerPreferenceMetadata: () => ({ min: 1, max: 10000 }),
    hydrateAppPreferences: vi.fn().mockResolvedValue({}),
    setObjPanelLogsBufferMaxSize: owner('objPanelLogsBufferMaxSize', prefs.setBufferSize),
    setObjPanelLogsTargetPerScopeLimit: owner(
      'objPanelLogsTargetPerScopeLimit',
      prefs.setPerScopeLimit
    ),
    setObjPanelLogsTargetGlobalLimit: owner('objPanelLogsTargetGlobalLimit', prefs.setGlobalLimit),
    setObjPanelLogsApiTimestampUseLocalTimeZone: owner(
      'objPanelLogsApiTimestampUseLocalTimeZone',
      prefs.setUseLocalTimeZone
    ),
    setObjPanelLogsApiTimestampFormat: owner(
      'objPanelLogsApiTimestampFormat',
      prefs.setTimestampFormat
    ),
  };
});

vi.mock('@core/desktop-runtime', () => ({ openURL: vi.fn() }));

describe('LogsSection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    resetAppPreferencesCacheForTesting();
    setAppPreferencesForTesting({
      objPanelLogsBufferMaxSize: 1000,
      objPanelLogsTargetPerScopeLimit: 20,
      objPanelLogsTargetGlobalLimit: 100,
      objPanelLogsApiTimestampUseLocalTimeZone: false,
      objPanelLogsApiTimestampFormat: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<LogsSection />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  // Inputs are found by the name they are announced with, so every lookup also
  // checks that the row's title labels its input.
  const inputFor = (label: string) =>
    requireValue(
      Array.from(container.querySelectorAll<HTMLInputElement>('input')).find(
        (input) => controlName(input) === label
      ),
      `input labelled ${label}`
    );

  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const leave = async (input: HTMLInputElement) => {
    await act(async () => {
      input.focus();
      input.blur();
    });
  };

  it('gives every input a name', () => {
    const unnamed = Array.from(container.querySelectorAll('input')).filter(
      (input) => controlName(input) === ''
    );
    expect(unnamed).toEqual([]);
  });

  it('saves the buffer size and container limits when each field is left', async () => {
    await type(inputFor('Buffer size'), '2500');
    await leave(inputFor('Buffer size'));
    await type(inputFor('Max containers per tab'), '30');
    await leave(inputFor('Max containers per tab'));
    await type(inputFor('Max containers across all tabs'), '150');
    await leave(inputFor('Max containers across all tabs'));

    expect(prefs.setBufferSize).toHaveBeenCalledWith(2500);
    expect(prefs.setPerScopeLimit).toHaveBeenCalledWith(30);
    expect(prefs.setGlobalLimit).toHaveBeenCalledWith(150);
    expect(inputFor('Buffer size').value).toBe('2500');
  });

  it('shows the value the preference owner settles on, such as after a failed save', async () => {
    await type(inputFor('Buffer size'), '2500');
    await leave(inputFor('Buffer size'));

    await act(async () => {
      setAppPreferencesForTesting({ objPanelLogsBufferMaxSize: 1000 });
    });

    expect(inputFor('Buffer size').value).toBe('1000');
  });

  it('switches API timestamps to the local time zone', async () => {
    const toggle = requireValue(
      container.querySelector<HTMLButtonElement>('button[role="switch"]'),
      'local time zone switch'
    );
    await act(async () => toggle.click());

    expect(prefs.setUseLocalTimeZone).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('rejects an invalid timestamp format and saves a valid one', async () => {
    const format = inputFor('Timestamp format');

    await type(format, 'HH:mm [x');
    await leave(format);
    expect(prefs.setTimestampFormat).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('[brackets]');
    expect(format.getAttribute('aria-invalid')).toBe('true');

    await type(format, ' HH:mm:ss ');
    await leave(format);
    expect(prefs.setTimestampFormat).toHaveBeenCalledWith('HH:mm:ss');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('12:34:55');
  });
});
