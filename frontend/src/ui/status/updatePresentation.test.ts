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
  it('covers getUpdatePresentation scenarios', async () => {
    for (const [status, message] of [
      [appupdates.Status.StatusDisabled, 'Automatic updates are unavailable in this build.'],
      [appupdates.Status.StatusChecking, 'Checking for updates…'],
      [appupdates.Status.StatusCurrent, 'Luxury Yacht is up to date.'],
      [appupdates.Status.StatusSkipped, '2.0.0 is available, but has been skipped'],
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
    ] as const) {
      // Scenarios: maps %s to its canonical message
      expect(getUpdatePresentation(update({ status }))?.message).toBe(message);
    }

    {
      // Scenario: keeps available download, skip, and restart actions separate
      const available = getUpdatePresentation(
        update({ status: appupdates.Status.StatusAvailable })
      );
      expect(available?.primary).toEqual({ kind: 'download', label: 'Download Update' });
      expect(available?.secondary).toEqual({ kind: 'skip', label: 'Skip This Version' });
      expect(
        getUpdatePresentation(update({ status: appupdates.Status.StatusReady }))?.primary
      ).toEqual({
        kind: 'restart',
        label: 'Restart & Apply',
      });
    }

    {
      // Scenario: offers only skip removal for a skipped release
      const skipped = getUpdatePresentation(update({ status: appupdates.Status.StatusSkipped }));

      expect(skipped?.primary).toEqual({ kind: 'remove-skip', label: 'Undo Skip' });
      expect(skipped?.secondary).toBeUndefined();
    }

    for (const [eligibilityReason, recoveryTarget, label] of [
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
        updateidentity.EligibilityReason.ReasonWindowsUnverifiedInstall,
        updateidentity.RecoveryTarget.RecoveryWindowsDownload,
        'View Windows Download',
      ],
      [
        updateidentity.EligibilityReason.ReasonManagedInstallation,
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
    ] as const) {
      // Scenarios: maps %s to its typed recovery action without staging
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

    {
      // Scenario: explains that managed installations update outside the app
      const presentation = getUpdatePresentation(
        update({
          status: appupdates.Status.StatusAvailable,
          canInstall: false,
          eligibilityReason: updateidentity.EligibilityReason.ReasonManagedInstallation,
          recoveryTarget: updateidentity.RecoveryTarget.RecoveryWindowsDownload,
        })
      );

      expect(presentation?.explanation).toBe(
        'This installation is managed outside the app. Use its installer or package manager to update it.'
      );
    }
    // Scenario: renders no update surface for idle state
    expect(getUpdatePresentation(update({ status: appupdates.Status.StatusIdle }))).toBeNull();

    for (const [status, badge] of [
      [appupdates.Status.StatusAvailable, 'Update available'],
      [appupdates.Status.StatusDownloading, 'Downloading update…'],
      [appupdates.Status.StatusVerifying, 'Verifying update…'],
      [appupdates.Status.StatusPreparing, 'Preparing update…'],
      [appupdates.Status.StatusReady, 'Restart to update'],
      [appupdates.Status.StatusCheckError, 'Update needs attention'],
      [appupdates.Status.StatusPrepareError, 'Update needs attention'],
      [appupdates.Status.StatusRestartError, 'Update needs attention'],
      [appupdates.Status.StatusApplyError, 'Update needs attention'],
    ] as const) {
      // Scenarios: badges %s for the header chip
      expect(getUpdatePresentation(update({ status }))?.badge).toBe(badge);
    }

    for (const status of [
      appupdates.Status.StatusDisabled,
      appupdates.Status.StatusChecking,
      appupdates.Status.StatusCurrent,
      appupdates.Status.StatusSkipped,
    ] as const) {
      // Scenarios: withholds a header badge for %s
      const presentation = getUpdatePresentation(update({ status }));
      expect(presentation).not.toBeNull();
      expect(presentation?.badge).toBeUndefined();
    }

    {
      // Scenario: surfaces the up-to-date state as a version note instead of a card
      const presentation = getUpdatePresentation(
        update({ status: appupdates.Status.StatusCurrent })
      );
      expect(presentation?.versionNote).toBe('no newer version is available');
    }

    {
      // Scenario: surfaces a skipped release and its exact version as a version note
      const presentation = getUpdatePresentation(
        update({ status: appupdates.Status.StatusSkipped, availableVersion: '2.0.0' })
      );

      expect(presentation?.versionNote).toBe('2.0.0 is available, but has been skipped');
    }

    for (const status of [
      appupdates.Status.StatusDisabled,
      appupdates.Status.StatusChecking,
      appupdates.Status.StatusAvailable,
      appupdates.Status.StatusDownloading,
      appupdates.Status.StatusReady,
      appupdates.Status.StatusCheckError,
    ] as const) {
      // Scenarios: keeps %s on the card, not on the version line
      expect(getUpdatePresentation(update({ status }))?.versionNote).toBeUndefined();
    }

    {
      // Scenario: carries the release identity, plain-text notes, and tag URL
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
    }

    {
      // Scenario: falls back to the available version when the release is unnamed
      const presentation = getUpdatePresentation(
        update({ status: appupdates.Status.StatusAvailable, releaseNotes: 'notes' })
      );
      expect(presentation?.releaseTitle).toBe('Luxury Yacht 2.0.0');
      expect(presentation?.published).toBeUndefined();
    }

    {
      // Scenario: omits release identity when no version was discovered
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
    }
  });
});
