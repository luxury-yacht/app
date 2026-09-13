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
  it('keeps available download, skip, and restart actions separate', () => {
    const available = getUpdatePresentation(update({ status: appupdates.Status.StatusAvailable }));
    expect(available?.primary?.kind).toBe('download');
    expect(available?.secondary?.kind).toBe('skip');
    expect(
      getUpdatePresentation(update({ status: appupdates.Status.StatusReady }))?.primary?.kind
    ).toBe('restart');
  });

  it('offers only skip removal for a skipped release', () => {
    const skipped = getUpdatePresentation(update({ status: appupdates.Status.StatusSkipped }));

    expect(skipped?.primary?.kind).toBe('remove-skip');
    expect(skipped?.secondary).toBeUndefined();
  });

  it.each([
    [
      updateidentity.EligibilityReason.ReasonMacNotInstalledBundle,
      updateidentity.RecoveryTarget.RecoveryMacDownload,
    ],
    [
      updateidentity.EligibilityReason.ReasonMacReadOnly,
      updateidentity.RecoveryTarget.RecoveryMacDownload,
    ],
    [
      updateidentity.EligibilityReason.ReasonMacUnwritableParent,
      updateidentity.RecoveryTarget.RecoveryMacDownload,
    ],
    [
      updateidentity.EligibilityReason.ReasonWindowsUnverifiedInstall,
      updateidentity.RecoveryTarget.RecoveryWindowsDownload,
    ],
    [
      updateidentity.EligibilityReason.ReasonManagedInstallation,
      updateidentity.RecoveryTarget.RecoveryWindowsDownload,
    ],
    [
      updateidentity.EligibilityReason.ReasonLinuxPackageManaged,
      updateidentity.RecoveryTarget.RecoveryLinuxPackages,
    ],
    [
      updateidentity.EligibilityReason.ReasonLinuxPortableIneligible,
      updateidentity.RecoveryTarget.RecoveryLinuxPortableDownload,
    ],
    [
      updateidentity.EligibilityReason.ReasonUnsupportedDistribution,
      updateidentity.RecoveryTarget.RecoveryDownloadOptions,
    ],
  ] as const)(
    'maps %s to its typed recovery action without staging',
    (eligibilityReason, recoveryTarget) => {
      const presentation = getUpdatePresentation(
        update({
          status: appupdates.Status.StatusAvailable,
          canInstall: false,
          eligibilityReason,
          recoveryTarget,
        })
      );

      expect(presentation?.primary?.kind).toBe('recovery');
      expect(presentation?.secondary?.kind).toBe('skip');
    }
  );

  it('renders no update surface for idle state', () => {
    expect(getUpdatePresentation(update({ status: appupdates.Status.StatusIdle }))).toBeNull();
  });

  it.each([
    appupdates.Status.StatusAvailable,
    appupdates.Status.StatusDownloading,
    appupdates.Status.StatusVerifying,
    appupdates.Status.StatusPreparing,
    appupdates.Status.StatusReady,
    appupdates.Status.StatusCheckError,
    appupdates.Status.StatusPrepareError,
    appupdates.Status.StatusRestartError,
    appupdates.Status.StatusApplyError,
  ] as const)('shows a header badge for %s', (status) => {
    expect(getUpdatePresentation(update({ status }))?.badge).toBeTruthy();
  });

  it.each([
    appupdates.Status.StatusDisabled,
    appupdates.Status.StatusChecking,
    appupdates.Status.StatusCurrent,
    appupdates.Status.StatusSkipped,
  ] as const)('withholds a header badge for %s', (status) => {
    const presentation = getUpdatePresentation(update({ status }));
    expect(presentation).not.toBeNull();
    expect(presentation?.badge).toBeUndefined();
  });

  it('surfaces the up-to-date state as a version note instead of a card', () => {
    const presentation = getUpdatePresentation(update({ status: appupdates.Status.StatusCurrent }));
    expect(presentation?.versionNote).toBeTruthy();
  });

  it('surfaces a skipped release and its exact version as a version note', () => {
    const presentation = getUpdatePresentation(
      update({ status: appupdates.Status.StatusSkipped, availableVersion: '2.0.0' })
    );

    expect(presentation?.versionNote).toContain('2.0.0');
  });

  it.each([
    appupdates.Status.StatusDisabled,
    appupdates.Status.StatusChecking,
    appupdates.Status.StatusAvailable,
    appupdates.Status.StatusDownloading,
    appupdates.Status.StatusReady,
    appupdates.Status.StatusCheckError,
  ] as const)('keeps %s on the card, not on the version line', (status) => {
    expect(getUpdatePresentation(update({ status }))?.versionNote).toBeUndefined();
  });

  it('carries the release identity, plain-text notes, and tag URL', () => {
    const presentation = getUpdatePresentation(
      update({
        status: appupdates.Status.StatusAvailable,
        releaseName: 'Luxury Yacht 2.0.0',
        publishedAt: '2026-07-05T12:00:00Z',
        releaseNotes: 'Fixed the metrics notice',
      })
    );

    expect(presentation?.releaseTitle).toBe('Luxury Yacht 2.0.0');
    expect(presentation?.notes).toBe('Fixed the metrics notice');
    // Release tags carry the conventional `v` prefix; availableVersion does not.
    expect(presentation?.releaseNotesURL).toBe(
      'https://github.com/luxury-yacht/app/releases/tag/v2.0.0'
    );
  });

  it('falls back to the available version when the release is unnamed', () => {
    const presentation = getUpdatePresentation(
      update({ status: appupdates.Status.StatusAvailable, releaseNotes: 'notes' })
    );
    expect(presentation?.releaseTitle).toContain('2.0.0');
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
