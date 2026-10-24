/**
 * frontend/src/ui/settings/sections/LogsSection.test.tsx
 *
 * The Logs settings save through the preference owner and follow it: limits
 * save when each field is left, a failed save shows the saved value again, the
 * local time zone switch saves, and an invalid timestamp format is rejected
 * inline while a valid one saves trimmed. Runs inside the production shell with
 * the real preference owner over the faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { controlName } from '@/test-utils/controlName';
import { requireValue } from '@/test-utils/requireValue';
import LogsSection from './LogsSection';

const app = installAppStateHarness();
let view: MountedApp;

/** Preference changes the backend saved, in order. */
const saved = () =>
  app.backend.calls('UpdateAppPreferences').flatMap(([request]) => request.changes ?? []);

// Inputs are found by the name they are announced with, so every lookup also
// checks that the row's title labels its input.
const inputFor = (label: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLInputElement>('input')).find(
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
  await app.settle();
};

beforeEach(async () => {
  app.preferences({
    objPanelLogsBufferMaxSize: 1000,
    objPanelLogsTargetPerScopeLimit: 20,
    objPanelLogsTargetGlobalLimit: 100,
    objPanelLogsApiTimestampUseLocalTimeZone: false,
    objPanelLogsApiTimestampFormat: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
  });
  // Mirrors backend/preferences_settings.go UpdateAppPreferences.
  app.backend.answer('UpdateAppPreferences', (request) => ({
    settings: null,
    changedKeys: (request.changes ?? []).map(({ key }) => key),
  }));
  view = await app.render(null);
  await view.show(<LogsSection />);
});

describe('LogsSection', () => {
  it('gives every input a name', () => {
    const unnamed = Array.from(view.container.querySelectorAll('input')).filter(
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

    expect(saved()).toEqual([
      { key: 'objPanelLogsBufferMaxSize', value: 2500 },
      { key: 'objPanelLogsTargetPerScopeLimit', value: 30 },
      { key: 'objPanelLogsTargetGlobalLimit', value: 150 },
    ]);
    expect(inputFor('Buffer size').value).toBe('2500');
  });

  it('shows the saved value again when a save fails', async () => {
    const failure = new Error('save failed');
    app.backend.answer('UpdateAppPreferences', () => {
      throw failure;
    });

    await type(inputFor('Buffer size'), '2500');
    await leave(inputFor('Buffer size'));

    expect(saved()).toEqual([{ key: 'objPanelLogsBufferMaxSize', value: 2500 }]);
    expect(inputFor('Buffer size').value).toBe('1000');
    expect(app.errors.take((record) => record.error === failure)).toEqual([
      expect.objectContaining({ kinds: ['operational'] }),
    ]);
  });

  it('switches API timestamps to the local time zone', async () => {
    const toggle = requireValue(
      view.container.querySelector<HTMLButtonElement>('button[aria-label="Use local time zone"]'),
      'local time zone switch'
    );
    await act(async () => toggle.click());
    await app.settle();

    expect(saved()).toEqual([{ key: 'objPanelLogsApiTimestampUseLocalTimeZone', value: true }]);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('rejects an invalid timestamp format and saves a valid one', async () => {
    const format = inputFor('Timestamp format');

    await type(format, 'HH:mm [x');
    await leave(format);
    expect(saved()).toEqual([]);
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('[brackets]');
    expect(format.getAttribute('aria-invalid')).toBe('true');

    await type(format, ' HH:mm:ss ');
    await leave(format);
    expect(saved()).toEqual([{ key: 'objPanelLogsApiTimestampFormat', value: 'HH:mm:ss' }]);
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(view.container.textContent).toContain('12:34:55');
  });
});
