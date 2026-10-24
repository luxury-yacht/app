/**
 * frontend/src/ui/settings/sections/ObjectPanelSection.test.tsx
 *
 * The Object Panel settings save the default position and the default panel
 * sizes through the preference owner, bound each size by its preference's
 * minimum, and resize object panels that are already docked. The first tests
 * run the section inside the production shell; the last runs the full app,
 * with Settings opened from its shortcut beside an open object panel. Only the
 * backend is faked (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import ObjectPanelSection from './ObjectPanelSection';

const app = installAppStateHarness();
let view: MountedApp;

/** Preference changes the backend saved, in order. */
const saved = () =>
  app.backend.calls('UpdateAppPreferences').flatMap(([request]) => request.changes ?? []);

const sizeInput = (label: string) =>
  requireValue(
    document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`),
    `expected the ${label} input`
  );

const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await app.settle();
};

beforeEach(() => {
  app.preferences({
    defaultObjectPanelPosition: 'right',
    objectPanelDockedRightWidth: 620,
    objectPanelDockedBottomHeight: 260,
    objectPanelFloatingWidth: 720,
    objectPanelFloatingHeight: 520,
  });
  // Mirrors backend/preferences_settings.go UpdateAppPreferences.
  app.backend.answer('UpdateAppPreferences', (request) => ({
    settings: null,
    changedKeys: (request.changes ?? []).map(({ key }) => key),
  }));
});

describe('ObjectPanelSection', () => {
  const showSection = async () => {
    view = await app.render(null);
    await view.show(<ObjectPanelSection />);
  };

  it('saves the chosen default position', async () => {
    await showSection();
    const position = (label: string) =>
      requireValue(
        Array.from(
          view.container.querySelectorAll<HTMLButtonElement>(
            'fieldset[aria-label="Default Object Panel position"] button'
          )
        ).find((button) => button.textContent === label),
        `expected the ${label} position`
      );
    expect(position('Right').getAttribute('aria-pressed')).toBe('true');

    await act(async () => position('Bottom').click());
    await app.settle();

    expect(saved()).toEqual([{ key: 'defaultObjectPanelPosition', value: 'bottom' }]);
    expect(position('Bottom').getAttribute('aria-pressed')).toBe('true');
    expect(position('Right').getAttribute('aria-pressed')).toBe('false');
  });

  it('bounds the floating size by its minimums and saves an edited size with the others', async () => {
    await showSection();
    const width = sizeInput('Floating width');
    const height = sizeInput('Floating height');
    expect([width.value, width.min, height.value, height.min]).toEqual([
      '720',
      '450',
      '520',
      '200',
    ]);

    await type(width, '810');

    expect(saved()).toEqual([
      { key: 'objectPanelDockedRightWidth', value: 620 },
      { key: 'objectPanelDockedBottomHeight', value: 260 },
      { key: 'objectPanelFloatingWidth', value: 810 },
      { key: 'objectPanelFloatingHeight', value: 520 },
    ]);
  });

  it('resizes an object panel already docked on the right to an edited default width', async () => {
    const dev: TestCluster = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    app.startScreen(dev);
    const configMap = app.servePanel(dev, {
      group: '',
      version: 'v1',
      kind: 'ConfigMap',
      namespace: 'default',
      name: 'app-config',
    });
    // Settings opens on Appearance, which lists the saved themes.
    app.backend.answer('GetThemes', () => []);
    view = await app.mountApp();
    await act(async () => view.owners().objectPanel.openWithObject(configMap.ref));
    await app.settle();
    // The width the content area reserves for the right dock.
    const dockOffset = () =>
      requireValue(
        document.body.querySelector<HTMLElement>('[data-dockable-group-key="right"]')?.parentElement
          ?.parentElement,
        'expected the right dock'
      ).style.getPropertyValue('--dock-right-offset');
    expect(dockOffset()).toBe('620px');

    // Settings > Ctrl+, outside macOS, then its Object Panel category.
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true, cancelable: true })
      );
    });
    await app.settle();
    const category = requireValue(
      Array.from(document.body.querySelectorAll<HTMLButtonElement>('.modal-sidebar-item')).find(
        (button) => button.textContent === 'Object Panel'
      ),
      'expected the Object Panel category'
    );
    await act(async () => category.click());
    await app.settle();

    await type(sizeInput('Docked right width'), '700');

    expect(dockOffset()).toBe('700px');
  });
});
