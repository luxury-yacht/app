/**
 * frontend/src/ui/settings/sections/DataManagementSection.test.tsx
 *
 * The Data Management settings: the Error Reporting switch saves through the
 * preference owner; exports and imports run their backend command and report
 * success; an import reads the imported settings or favorites back into the
 * app, and every operation stays blocked until that read finishes; a canceled
 * dialog reports nothing and reads nothing; a failed command is reported under
 * its action. Runs inside the production shell with the real preference and
 * favorites owners over the faked backend (test-utils/appState).
 */

import type { backend } from '@core/backend-api/models';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFavorites } from '@/core/contexts/FavoritesContext';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { requireValue } from '@/test-utils/requireValue';
import DataManagementSection from './DataManagementSection';

const app = installAppStateHarness();
let view: MountedApp;
let favoriteNames: string[] = [];

function FavoritesProbe() {
  favoriteNames = useFavorites().favorites.map((favorite) => favorite.name);
  return null;
}

const chosen = { canceled: false, path: '/tmp/luxury-yacht.json' };
const canceled = { canceled: true, path: '' };

const button = (label: string) =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent === label
    ),
    `expected the ${label} button`
  );

const operations = () =>
  ['Export Settings', 'Import Settings', 'Export Favorites', 'Import Favorites'].map(button);

const errorReporting = () =>
  requireValue(
    view.container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Error Reporting"]'
    ),
    'expected the Error Reporting switch'
  );

const status = () => view.container.querySelector('[role="status"]')?.textContent ?? null;

const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await app.settle();
};

beforeEach(async () => {
  favoriteNames = [];
  app.preferences({ errorReportingEnabled: false });
  // Mirrors backend/preferences_settings.go UpdateAppPreferences.
  app.backend.answer('UpdateAppPreferences', (request) => ({
    settings: null,
    changedKeys: (request.changes ?? []).map(({ key }) => key),
  }));
  app.backend.answer('ExportSettings', () => chosen);
  app.backend.answer('ImportSettings', () => chosen);
  app.backend.answer('ExportFavorites', () => chosen);
  app.backend.answer('ImportFavorites', () => chosen);
  view = await app.render(null);
  await view.show(
    <>
      <DataManagementSection />
      <FavoritesProbe />
    </>
  );
});

describe('DataManagementSection', () => {
  it('saves the Error Reporting switch', async () => {
    expect(errorReporting().getAttribute('aria-checked')).toBe('false');

    await click(errorReporting());

    expect(
      app.backend.calls('UpdateAppPreferences').flatMap(([request]) => request.changes ?? [])
    ).toEqual([{ key: 'errorReportingEnabled', value: true }]);
    expect(errorReporting().getAttribute('aria-checked')).toBe('true');
  });

  it.each([
    ['Export Settings', 'ExportSettings', 'Settings exported.'],
    ['Export Favorites', 'ExportFavorites', 'Favorites exported.'],
  ] as const)('%s runs its backend export and reports success', async (label, method, success) => {
    await click(button(label));

    expect(app.backend.calls(method)).toHaveLength(1);
    expect(status()).toBe(success);
  });

  it('imports settings and shows the imported values', async () => {
    // The backend's import replaces the saved settings.
    app.backend.answer('ImportSettings', () => {
      app.preferences({ errorReportingEnabled: true });
      return chosen;
    });

    await click(button('Import Settings'));

    expect(status()).toBe('Settings imported.');
    expect(errorReporting().getAttribute('aria-checked')).toBe('true');
  });

  it('reports imported settings it cannot read back, and keeps the current ones', async () => {
    // The user had turned error reporting on.
    await click(errorReporting());
    app.backend.answer('GetAppSettings', () => {
      throw new Error('saved settings unreadable');
    });

    await click(button('Import Settings'));

    expect(status()).toBeNull();
    expect(app.errors.take((record) => record.context?.action === 'importSettings')).toHaveLength(
      1
    );
    expect(errorReporting().getAttribute('aria-checked')).toBe('true');
  });

  it('imports favorites and the app’s favorites list shows them', async () => {
    let saved: backend.Favorite[] = [];
    app.backend.answer('GetFavorites', () => saved);
    app.backend.answer('ImportFavorites', () => {
      saved = [partialModelFixture<backend.Favorite>({ id: 'fav-1', name: 'Prod pods', order: 0 })];
      return chosen;
    });

    await click(button('Import Favorites'));

    expect(status()).toBe('Favorites imported.');
    expect(favoriteNames).toEqual(['Prod pods']);
  });

  it.each([
    ['Settings', 'GetAppSettings'],
    ['Favorites', 'GetFavorites'],
  ] as const)(
    'keeps every operation blocked while imported %s are read back',
    async (kind, read) => {
      const release = app.backend.hold(read);

      await click(button(`Import ${kind}`));

      expect(operations().every((candidate) => candidate.disabled)).toBe(true);
      await click(button('Export Settings'));
      expect(app.backend.calls('ExportSettings')).toHaveLength(0);
      expect(status()).toBeNull();

      await act(async () => release());
      await app.settle();

      expect(operations().every((candidate) => !candidate.disabled)).toBe(true);
      expect(status()).toBe(`${kind} imported.`);
    }
  );

  it.each([
    ['Export Favorites', 'ExportFavorites', null],
    ['Import Settings', 'ImportSettings', 'GetAppSettings'],
    ['Import Favorites', 'ImportFavorites', 'GetFavorites'],
  ] as const)(
    'reports nothing and reads nothing back when %s is canceled',
    async (label, method, read) => {
      app.backend.answer(method, () => canceled);
      const readsBefore = read ? app.backend.calls(read).length : 0;

      await click(button(label));

      expect(app.backend.calls(method)).toHaveLength(1);
      expect(status()).toBeNull();
      if (read) {
        expect(app.backend.calls(read)).toHaveLength(readsBefore);
      }
    }
  );

  it.each([
    ['Export Settings', 'ExportSettings', 'exportSettings'],
    ['Import Favorites', 'ImportFavorites', 'importFavorites'],
  ] as const)('reports a failed %s under its action', async (label, method, action) => {
    const failure = new Error(`${action} failed`);
    app.backend.answer(method, () => {
      throw failure;
    });

    await click(button(label));

    expect(
      app.errors.take((record) => record.error === failure && record.context?.action === action)
    ).toHaveLength(1);
    expect(status()).toBeNull();
    expect(operations().every((candidate) => !candidate.disabled)).toBe(true);
  });
});
