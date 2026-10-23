/**
 * frontend/src/ui/settings/sections/DisplaySection.test.tsx
 *
 * The Display settings save their switches and the default page size through
 * the preference owner, and a switch whose save fails shows the saved value
 * again and reports the failure under its action. Runs inside the production
 * shell with the real preference owner and dropdown over the faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import DisplaySection from './DisplaySection';

const app = installAppStateHarness();
let view: MountedApp;

/** Preference changes the backend saved, in order. */
const saved = () =>
  app.backend.calls('UpdateAppPreferences').flatMap(([request]) => request.changes ?? []);

const control = (label: string) =>
  requireValue(
    view.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
    `expected the ${label} control`
  );

const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await app.settle();
};

beforeEach(async () => {
  app.preferences({
    useShortResourceNames: false,
    dimInactiveNamespaces: true,
    exclusiveNamespaces: true,
    defaultTablePageSize: 50,
  });
  // Mirrors backend/preferences_settings.go UpdateAppPreferences.
  app.backend.answer('UpdateAppPreferences', (request) => ({
    settings: null,
    changedKeys: (request.changes ?? []).map(({ key }) => key),
  }));
  view = await app.render(null);
  await view.show(<DisplaySection />);
});

describe('DisplaySection', () => {
  it('saves each display switch', async () => {
    await click(control('Short resource names'));
    await click(control('Dim inactive namespaces'));
    await click(control('Exclusive namespaces'));

    expect(saved()).toEqual([
      { key: 'useShortResourceNames', value: true },
      { key: 'dimInactiveNamespaces', value: false },
      { key: 'exclusiveNamespaces', value: false },
    ]);
    expect(
      ['Short resource names', 'Dim inactive namespaces', 'Exclusive namespaces'].map((label) =>
        control(label).getAttribute('aria-checked')
      )
    ).toEqual(['true', 'false', 'false']);
  });

  it('saves the default page size chosen from its dropdown', async () => {
    const trigger = control('Default page size');
    await click(trigger);
    const menu = requireValue(
      document.getElementById(trigger.getAttribute('aria-controls') ?? ''),
      'expected the page size menu'
    );
    await click(
      requireValue(
        Array.from(menu.querySelectorAll<HTMLElement>('.dropdown-option')).find(
          (option) => option.textContent?.trim() === '250'
        ),
        'expected the 250 option'
      )
    );

    expect(saved()).toEqual([{ key: 'defaultTablePageSize', value: 250 }]);
    expect(trigger.textContent).toContain('250');
  });

  it('shows the saved value again and reports the failure when a switch fails to save', async () => {
    const failure = new Error('persistence failed');
    app.backend.answer('UpdateAppPreferences', () => {
      throw failure;
    });
    const toggle = control('Short resource names');

    await click(toggle);

    expect(saved()).toEqual([{ key: 'useShortResourceNames', value: true }]);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(
      app.errors.take(
        (record) =>
          record.error === failure && record.context?.action === 'setUseShortResourceNames'
      )
    ).toHaveLength(1);
  });
});
