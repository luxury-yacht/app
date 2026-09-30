/**
 * frontend/src/ui/settings/sections/LogsSection.test.tsx
 *
 * The Logs settings persist through the preference owner and follow it,
 * including when a failed write rolls a value back.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { controlName } from '@/test-utils/controlName';
import { requireValue } from '@/test-utils/requireValue';
import LogsSection from './LogsSection';

const prefs = vi.hoisted(() => ({
  values: {
    bufferSize: 1000,
    perScopeLimit: 20,
    globalLimit: 100,
    useLocalTimeZone: false,
    timestampFormat: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
  },
  setBufferSize: vi.fn(),
  setPerScopeLimit: vi.fn(),
  setGlobalLimit: vi.fn(),
  setUseLocalTimeZone: vi.fn(),
  setTimestampFormat: vi.fn(),
}));

// The owner updates its value and announces it, as the optimistic setters do.
vi.mock('@/core/settings/appPreferences', async () => {
  const { eventBus: bus } = await import('@/core/events');
  return {
    commitIntegerPreferenceInput: (_key: string, raw: string, persist: (value: number) => void) => {
      const value = Number(raw);
      persist(value);
      return value;
    },
    getIntegerPreferenceMetadata: () => ({ min: 1, max: 10000 }),
    hydrateAppPreferences: vi.fn().mockResolvedValue({}),
    getObjPanelLogsBufferMaxSize: () => prefs.values.bufferSize,
    getObjPanelLogsTargetPerScopeLimit: () => prefs.values.perScopeLimit,
    getObjPanelLogsTargetGlobalLimit: () => prefs.values.globalLimit,
    getObjPanelLogsApiTimestampUseLocalTimeZone: () => prefs.values.useLocalTimeZone,
    getObjPanelLogsApiTimestampFormat: () => prefs.values.timestampFormat,
    setObjPanelLogsBufferMaxSize: (value: number) => {
      prefs.setBufferSize(value);
      prefs.values.bufferSize = value;
      bus.emit('settings:obj-panel-logs-buffer-size', value);
    },
    setObjPanelLogsTargetPerScopeLimit: (value: number) => {
      prefs.setPerScopeLimit(value);
      prefs.values.perScopeLimit = value;
      bus.emit('settings:obj-panel-logs-target-per-scope-limit', value);
    },
    setObjPanelLogsTargetGlobalLimit: (value: number) => {
      prefs.setGlobalLimit(value);
      prefs.values.globalLimit = value;
      bus.emit('settings:obj-panel-logs-target-global-limit', value);
    },
    setObjPanelLogsApiTimestampUseLocalTimeZone: (value: boolean) => {
      prefs.setUseLocalTimeZone(value);
      prefs.values.useLocalTimeZone = value;
      bus.emit('settings:obj-panel-logs-api-timestamp-use-local-time-zone', value);
    },
    setObjPanelLogsApiTimestampFormat: (value: string) => {
      prefs.setTimestampFormat(value);
      prefs.values.timestampFormat = value;
      bus.emit('settings:obj-panel-logs-api-timestamp-format', value);
    },
  };
});

vi.mock('@core/desktop-runtime', () => ({ openURL: vi.fn() }));

describe('LogsSection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(async () => {
    prefs.values = {
      bufferSize: 1000,
      perScopeLimit: 20,
      globalLimit: 100,
      useLocalTimeZone: false,
      timestampFormat: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
    };
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
      prefs.values.bufferSize = 1000;
      eventBus.emit('settings:obj-panel-logs-buffer-size', 1000);
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
