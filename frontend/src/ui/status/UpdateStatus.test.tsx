/**
 * frontend/src/ui/status/UpdateStatus.test.tsx
 *
 * The header update chip appears only for an update that needs the user's
 * attention and opens About, which owns the update workflow, without opening a
 * URL itself; a live update event wins over an app-info read that answers
 * after it. Which states need attention is updatePresentation's contract
 * (updatePresentation.test.ts). Runs in the full app over the faked backend
 * (test-utils/appState).
 */

import { appupdates, type backend } from '@core/backend-api/models';
import { Browser } from '@wailsio/runtime';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let view: MountedApp;

const update = (fields: Partial<backend.UpdateInfo>) =>
  partialModelFixture<backend.UpdateInfo>({ currentVersion: '1.10.0', ...fields });

/** The app reports this update in its app info. */
const reportUpdate = (info: backend.UpdateInfo) => {
  app.backend.answer('GetAppInfo', () => ({
    version: '1.10.0',
    buildTime: '',
    gitCommit: '',
    isBeta: false,
    update: info,
  }));
};

const chip = () =>
  view.container.querySelector<HTMLButtonElement>('.app-header-controls .update-chip');

const start = async () => {
  view = await app.mountApp();
};

beforeEach(() => {
  vi.mocked(Browser.OpenURL).mockClear();
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  app.startScreen(dev);
});

describe('UpdateStatus', () => {
  it('shows a chip for an available update that opens About and opens no URL', async () => {
    reportUpdate(
      update({
        status: appupdates.Status.StatusAvailable,
        availableVersion: '1.10.1',
        releaseNotes: '- Fixed metrics permission notice',
        canInstall: true,
      })
    );
    await start();
    expect(chip()?.textContent).toBe('Update available');

    await act(async () => requireValue(chip(), 'expected the update chip').click());
    await app.settle();

    expect(view.owners().viewState?.isAboutOpen).toBe(true);
    expect(document.body.querySelector('[aria-label="Application update"]')).not.toBeNull();
    expect(vi.mocked(Browser.OpenURL)).not.toHaveBeenCalled();
  });

  it('shows no chip when the app is up to date', async () => {
    reportUpdate(update({ status: appupdates.Status.StatusCurrent }));
    await start();

    expect(chip()).toBeNull();
  });

  it('keeps a live update event when the app-info read answers after it', async () => {
    reportUpdate(update({ status: appupdates.Status.StatusAvailable, availableVersion: '2.0.0' }));
    const release = app.backend.hold('GetAppInfo');
    await start();
    expect(chip()).toBeNull();

    await act(async () => {
      app.events.emit(
        'app-update',
        update({ status: appupdates.Status.StatusReady, availableVersion: '2.0.0' })
      );
    });
    await act(async () => release());
    await app.settle();

    expect(chip()?.textContent).toBe('Restart to update');
  });
});
