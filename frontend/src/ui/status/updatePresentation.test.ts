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
});
