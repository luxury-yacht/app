import { appupdates, type backend, updateidentity } from '@core/backend-api/models';
import { describe, expect, it } from 'vitest';
import { getUpdatePresentation } from './updatePresentation';

const update = (overrides: Partial<backend.UpdateInfo>): backend.UpdateInfo => ({
  status: appupdates.Status.StatusIdle,
  currentVersion: '1.9.0',
  availableVersion: '2.0.0',
  canCheck: true,
  canInstall: true,
  ...overrides,
});

describe('getUpdatePresentation', () => {
  it.each([
    [appupdates.Status.StatusDisabled, 'Automatic updates are unavailable in this build.'],
    [appupdates.Status.StatusChecking, 'Checking for updates…'],
    [appupdates.Status.StatusCurrent, 'Luxury Yacht is up to date.'],
    [appupdates.Status.StatusDownloading, 'Downloading update…'],
    [appupdates.Status.StatusVerifying, 'Verifying update…'],
    [appupdates.Status.StatusPreparing, 'Preparing update…'],
    [appupdates.Status.StatusReady, 'Luxury Yacht 2.0.0 is ready to install.'],
    [appupdates.Status.StatusCheckError, 'Couldn’t check for updates.'],
    [appupdates.Status.StatusPrepareError, 'Couldn’t prepare the update.'],
    [appupdates.Status.StatusRestartError, 'Couldn’t restart to apply the update.'],
    [
      appupdates.Status.StatusApplyError,
      'The update couldn’t be applied. Luxury Yacht is still on 1.9.0.',
    ],
  ] as const)('maps %s to its canonical message', (status, message) => {
    expect(getUpdatePresentation(update({ status }))?.message).toBe(message);
  });

  it('keeps available download, skip, and restart actions separate', () => {
    const available = getUpdatePresentation(update({ status: appupdates.Status.StatusAvailable }));
    expect(available?.primary).toEqual({ kind: 'download', label: 'Download Update' });
    expect(available?.secondary).toEqual({ kind: 'skip', label: 'Skip This Version' });
    expect(
      getUpdatePresentation(update({ status: appupdates.Status.StatusReady }))?.primary
    ).toEqual({
      kind: 'restart',
      label: 'Restart & Apply',
    });
  });

  it.each([
    [
      updateidentity.EligibilityReason.ReasonMacNotInstalledBundle,
      updateidentity.RecoveryTarget.RecoveryMacDownload,
      'View macOS Download',
    ],
    [
      updateidentity.EligibilityReason.ReasonMacReadOnly,
      updateidentity.RecoveryTarget.RecoveryMacDownload,
      'View macOS Download',
    ],
    [
      updateidentity.EligibilityReason.ReasonMacUnwritableParent,
      updateidentity.RecoveryTarget.RecoveryMacDownload,
      'View macOS Download',
    ],
    [
      updateidentity.EligibilityReason.ReasonWindowsMachineScope,
      updateidentity.RecoveryTarget.RecoveryWindowsPerUserMigration,
      'Switch to Per-User Installation',
    ],
    [
      updateidentity.EligibilityReason.ReasonWindowsUnverifiedInstall,
      updateidentity.RecoveryTarget.RecoveryWindowsDownload,
      'View Windows Download',
    ],
    [
      updateidentity.EligibilityReason.ReasonLinuxPackageManaged,
      updateidentity.RecoveryTarget.RecoveryLinuxPackages,
      'View Linux Packages',
    ],
    [
      updateidentity.EligibilityReason.ReasonLinuxPortableIneligible,
      updateidentity.RecoveryTarget.RecoveryLinuxPortableDownload,
      'View Portable Download',
    ],
    [
      updateidentity.EligibilityReason.ReasonUnsupportedDistribution,
      updateidentity.RecoveryTarget.RecoveryDownloadOptions,
      'View Download Options',
    ],
  ] as const)(
    'maps %s to its typed recovery action without staging',
    (eligibilityReason, recoveryTarget, label) => {
      const presentation = getUpdatePresentation(
        update({
          status: appupdates.Status.StatusAvailable,
          canInstall: false,
          eligibilityReason,
          recoveryTarget,
        })
      );

      expect(presentation?.primary).toMatchObject({ kind: 'recovery', label });
      expect(presentation?.secondary).toEqual({ kind: 'skip', label: 'Skip This Version' });
    }
  );

  it('renders no update surface for idle state', () => {
    expect(getUpdatePresentation(update({ status: appupdates.Status.StatusIdle }))).toBeNull();
  });

  it.each([
    [appupdates.Status.StatusAvailable, 'Update available', 'info'],
    [appupdates.Status.StatusDownloading, 'Downloading update…', 'progress'],
    [appupdates.Status.StatusVerifying, 'Verifying update…', 'progress'],
    [appupdates.Status.StatusPreparing, 'Preparing update…', 'progress'],
    [appupdates.Status.StatusReady, 'Restart to update', 'ready'],
    [appupdates.Status.StatusCheckError, 'Update needs attention', 'error'],
    [appupdates.Status.StatusPrepareError, 'Update needs attention', 'error'],
    [appupdates.Status.StatusRestartError, 'Update needs attention', 'error'],
    [appupdates.Status.StatusApplyError, 'Update needs attention', 'error'],
  ] as const)('badges %s for the header chip', (status, badge, tone) => {
    const presentation = getUpdatePresentation(update({ status }));
    expect(presentation?.badge).toBe(badge);
    expect(presentation?.tone).toBe(tone);
  });

  it.each([
    appupdates.Status.StatusDisabled,
    appupdates.Status.StatusChecking,
    appupdates.Status.StatusCurrent,
  ] as const)('withholds a header badge for %s', (status) => {
    const presentation = getUpdatePresentation(update({ status }));
    expect(presentation).not.toBeNull();
    expect(presentation?.badge).toBeUndefined();
  });

  it('carries the release identity, plain-text notes, and tag URL', () => {
    const presentation = getUpdatePresentation(
      update({
        status: appupdates.Status.StatusAvailable,
        releaseName: 'Luxury Yacht 2.0.0',
        publishedAt: '2026-07-05T12:00:00Z',
        releaseNotes: '## Highlights\n\n- Fixed the **metrics** notice',
      })
    );

    expect(presentation?.releaseTitle).toBe('Luxury Yacht 2.0.0');
    expect(presentation?.published).toBe('2026-07-05');
    expect(presentation?.notes).toBe('Highlights\n\n• Fixed the metrics notice');
    // Release tags carry the conventional `v` prefix; availableVersion does not.
    expect(presentation?.releaseNotesURL).toBe(
      'https://github.com/luxury-yacht/app/releases/tag/v2.0.0'
    );
  });

  it('falls back to the available version when the release is unnamed', () => {
    const presentation = getUpdatePresentation(
      update({ status: appupdates.Status.StatusAvailable, releaseNotes: 'notes' })
    );
    expect(presentation?.releaseTitle).toBe('Luxury Yacht 2.0.0');
    expect(presentation?.published).toBeUndefined();
  });

  it('omits release identity when no version was discovered', () => {
    const presentation = getUpdatePresentation(
      update({
        status: appupdates.Status.StatusCheckError,
        availableVersion: undefined,
        publishedAt: 'not-a-date',
        releaseNotes: '',
      })
    );

    expect(presentation?.releaseTitle).toBeUndefined();
    expect(presentation?.releaseNotesURL).toBeUndefined();
    expect(presentation?.published).toBeUndefined();
    expect(presentation?.notes).toBeUndefined();
  });
});
