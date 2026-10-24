/**
 * frontend/src/ui/modals/SettingsModal.test.tsx
 *
 * The Settings modal as the app opens it: the dialog is named by its visible
 * title, its categories are one Tab stop moved with the arrow keys, choosing a
 * category shows that section and Settings reopens on it, Escape closes it,
 * and the page cannot scroll behind it while it is open. Runs in the full app
 * with the real settings sections over the faked backend (test-utils/appState);
 * Settings opens from its menu accelerator.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let view: MountedApp;

const keydown = (key: string, init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

/** Presses a key where focus is; returns the event to read whether it was claimed. */
const press = async (key: string, init: KeyboardEventInit = {}) => {
  const event = keydown(key, init);
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
};

/** Settings > Ctrl+, outside macOS. */
const openSettings = async () => {
  await act(async () => {
    document.body.dispatchEvent(keydown(',', { ctrlKey: true }));
  });
  await app.settle();
};

const settingsOpen = () => view.owners().viewState?.isSettingsOpen;

const category = (label: string) =>
  requireValue(
    Array.from(document.querySelectorAll<HTMLButtonElement>('.modal-sidebar-item')).find(
      (button) => button.textContent === label
    ),
    `expected the ${label} category`
  );

const categoryTabStops = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.modal-sidebar-item')).filter(
    (button) => button.tabIndex === 0
  );

const shownSection = () =>
  document.querySelector('.settings-modal-content .settings-panel-title')?.textContent;

const closeButton = () =>
  requireValue(
    document.querySelector<HTMLButtonElement>('button[aria-label="Close Settings"]'),
    'expected the Settings close button'
  );

beforeEach(async () => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  app.startScreen(dev);
  // The Appearance section lists the saved themes.
  app.backend.answer('GetThemes', () => []);
  view = await app.mountApp();
  await openSettings();
});

describe('SettingsModal', () => {
  it('keeps the categories at one Tab stop and moves their focus with the arrow keys', async () => {
    expect(document.activeElement).toBe(closeButton());
    expect(categoryTabStops()).toEqual([category('Appearance')]);
    await press('Tab');
    expect(document.activeElement).toBe(category('Appearance'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(category('Kubeconfigs'));
    expect(categoryTabStops()).toEqual([category('Kubeconfigs')]);
    // Moving focus does not choose the category.
    expect(category('Appearance').getAttribute('aria-current')).toBe('page');
    await press('ArrowUp');
    await press('ArrowUp');
    expect(document.activeElement).toBe(category('Advanced'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(category('Appearance'));
    await press('End');
    expect(document.activeElement).toBe(category('Advanced'));
    await press('Home');
    expect(document.activeElement).toBe(category('Appearance'));
    expect((await press('ArrowDown', { altKey: true })).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(category('Appearance'));
    // Enter and Space keep their native button activation.
    expect((await press('Enter')).defaultPrevented).toBe(false);
    expect((await press(' ')).defaultPrevented).toBe(false);
  });

  it('passes Tab between the categories and the shown section', async () => {
    const firstAppearanceControl = requireValue(
      document.querySelector<HTMLButtonElement>('fieldset[aria-label="Appearance mode"] button'),
      'expected the appearance mode choices'
    );
    await press('Tab');
    await press('ArrowDown');
    await press('Tab');
    expect(document.activeElement).toBe(firstAppearanceControl);
    // Arrows inside a section belong to its controls.
    expect((await press('ArrowDown')).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(firstAppearanceControl);
    await press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(category('Kubeconfigs'));

    await act(async () => category('Display').click());
    await app.settle();
    expect(categoryTabStops()).toEqual([category('Display')]);
    expect(shownSection()).toBe('Display');
    await press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(closeButton());
    await press('Tab');
    expect(document.activeElement).toBe(category('Display'));
  });

  it('names the dialog by its visible title', () => {
    const dialog = requireValue(document.querySelector('[role="dialog"]'), 'settings dialog');
    const titleId = requireValue(dialog.getAttribute('aria-labelledby'), 'dialog label reference');
    const title = requireValue(document.getElementById(titleId), 'referenced dialog title');

    expect(dialog.contains(title)).toBe(true);
    expect(title.textContent).toContain('Settings');
  });

  it('closes on Escape and lets the page scroll again', async () => {
    expect(document.body.style.overflow).toBe('hidden');

    await press('Escape');
    await app.settle();

    expect(settingsOpen()).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('shows the chosen category’s section and reopens on it', async () => {
    expect(shownSection()).toBe('Appearance');

    await act(async () => category('Display').click());
    await app.settle();
    expect(shownSection()).toBe('Display');

    await press('Escape');
    await app.settle();
    expect(settingsOpen()).toBe(false);
    await openSettings();

    expect(shownSection()).toBe('Display');
    expect(categoryTabStops()).toEqual([category('Display')]);
  });
});
