/**
 * frontend/src/ui/settings/sections/AdvancedSection.test.tsx
 *
 * The Advanced settings: every input is named; the auto-refresh and
 * per-namespace-view switches and the Kubernetes API limits save through the
 * preference owner (a limit on blur or Enter, bounded by its metadata); Reset
 * Views clears the saved table layouts after confirmation; Factory Reset clears
 * the backend's state, the saved layouts, browser storage, and the theme
 * overrides applied to the page. Runs inside the production shell with the real
 * preference owner over the faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { controlName } from '@/test-utils/controlName';
import { requireValue } from '@/test-utils/requireValue';
import AdvancedSection from './AdvancedSection';

const app = installAppStateHarness();
let view: MountedApp;

/** Preference changes the backend saved, in order. */
const saved = () =>
  app.backend.calls('UpdateAppPreferences').flatMap(([request]) => request.changes ?? []);

const button = (label: string) =>
  requireValue(
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === label
    ),
    `expected the ${label} button`
  );

const confirm = () =>
  requireValue(
    Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.confirmation-modal-footer button')
    ).find((candidate) => candidate.textContent?.trim() === 'Confirm'),
    'expected the confirmation button'
  );

const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await app.settle();
};

const inputNamed = (label: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLInputElement>('input')).find(
      (field) => controlName(field) === label
    ),
    `expected the ${label} input`
  );

const rootStyle = (property: string) => document.documentElement.style.getPropertyValue(property);

beforeEach(async () => {
  app.preferences({
    appearanceMode: 'light',
    autoRefreshEnabled: true,
    gridTablePersistenceMode: 'shared',
    kubernetesClientQPS: 100,
    kubernetesClientBurst: 200,
    permissionSSRRFetchConcurrency: 8,
    // A themed page: the shell applies these overrides when it starts.
    paletteHueLight: 200,
    paletteSaturationLight: 40,
    accentColorLight: '#123456',
    linkColorLight: '#654321',
  });
  // Mirrors backend/preferences_settings.go UpdateAppPreferences: the next read
  // returns what was saved.
  app.backend.answer('UpdateAppPreferences', (request) => {
    const changes = request.changes ?? [];
    app.preferences(Object.fromEntries(changes.map(({ key, value }) => [key, value])));
    return { settings: null, changedKeys: changes.map(({ key }) => key) };
  });
  app.backend.answer('ClearGridTablePersistence', () => 3);
  view = await app.render(null);
  await view.show(<AdvancedSection />);
});

describe('AdvancedSection', () => {
  it('gives every input a name', () => {
    const unnamed = Array.from(view.container.querySelectorAll('input')).filter(
      (input) => controlName(input) === ''
    );
    expect(unnamed).toEqual([]);
  });

  it('saves the auto-refresh and per-namespace view switches', async () => {
    const refresh = requireValue(
      view.container.querySelector<HTMLButtonElement>('[aria-label="Auto-refresh"]'),
      'expected the auto-refresh switch'
    );
    const perNamespace = requireValue(
      view.container.querySelector<HTMLButtonElement>('[aria-label="Per-namespace views"]'),
      'expected the per-namespace views switch'
    );

    await click(refresh);
    await click(perNamespace);

    expect(saved()).toEqual([
      { key: 'autoRefreshEnabled', value: false },
      { key: 'gridTablePersistenceMode', value: 'namespaced' },
    ]);
    expect(refresh.getAttribute('aria-checked')).toBe('false');
    expect(perNamespace.getAttribute('aria-checked')).toBe('true');
  });

  it('clears the saved table layouts only after Reset Views is confirmed', async () => {
    await click(button('Reset Views'));
    expect(app.backend.calls('ClearGridTablePersistence')).toHaveLength(0);

    await click(confirm());

    expect(app.backend.calls('ClearGridTablePersistence')).toHaveLength(1);
    expect(document.body.querySelector('.confirmation-modal-footer')).toBeNull();
  });

  it.each(['blur', 'Enter'])(
    'saves edited Kubernetes API limits on %s, bounded by their limits',
    async (commit) => {
      const edits = [
        { label: 'Client QPS', typed: '321', value: 321 },
        // Above the preference's maximum (appPreferences.ts KUBERNETES_CLIENT_BURST_MAX).
        { label: 'Client burst allowance', typed: '20000', value: 10000 },
        { label: 'SSRR concurrency', typed: '12', value: 12 },
      ];

      for (const { label, typed } of edits) {
        const input = inputNamed(label);
        await act(async () => {
          input.focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            input,
            typed
          );
          input.dispatchEvent(new Event('input', { bubbles: true }));
          if (commit === 'Enter') {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          } else {
            input.blur();
          }
        });
        await app.settle();
      }

      expect(saved()).toEqual([
        { key: 'kubernetesClientQPS', value: 321 },
        { key: 'kubernetesClientBurst', value: 10000 },
        { key: 'permissionSSRRFetchConcurrency', value: 12 },
      ]);
      expect(edits.map(({ label }) => inputNamed(label).value)).toEqual(
        edits.map(({ value }) => String(value))
      );
    }
  );

  it('clears the backend state, saved layouts, storage, and theme overrides on Factory Reset', async () => {
    app.backend.answer('ClearAppState', () => undefined);
    localStorage.setItem('test-setting', 'value');
    sessionStorage.setItem('test-session', 'value');
    expect(rootStyle('--color-accent-light-600')).not.toBe('');
    expect(rootStyle('--color-object-panel-link')).not.toBe('');
    expect(rootStyle('--color-base-500')).not.toBe('');

    await click(button('Factory Reset'));
    await click(confirm());

    expect(app.backend.calls('ClearAppState')).toHaveLength(1);
    expect(app.backend.calls('ClearGridTablePersistence')).toHaveLength(1);
    expect(localStorage.getItem('test-setting')).toBeNull();
    expect(sessionStorage.getItem('test-session')).toBeNull();
    expect(rootStyle('--color-accent-light-600')).toBe('');
    expect(rootStyle('--color-object-panel-link')).toBe('');
    expect(rootStyle('--color-base-500')).toBe('');
  });
});
