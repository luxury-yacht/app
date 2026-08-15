/**
 * frontend/src/ui/modals/AboutModal.stories.tsx
 *
 * Storybook stories for the AboutModal component.
 */

import { Status } from '@bindings/github.com/luxury-yacht/app/backend/internal/appupdates/models';
import {
  Distribution,
  EligibilityReason,
  RecoveryTarget,
} from '@bindings/github.com/luxury-yacht/app/internal/updateidentity/models';
import type { backend } from '@core/backend-api/models';
import type { Meta, StoryObj } from '@storybook/react';
import type React from 'react';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { KeyboardProviderDecorator } from '../../../.storybook/decorators/KeyboardProviderDecorator';
import { setMockAppInfo } from '../../../.storybook/mocks/wailsBackendApp';
import AboutModal from './AboutModal';

const meta: Meta<typeof AboutModal> = {
  title: 'Modals/AboutModal',
  component: AboutModal,
  decorators: [KeyboardProviderDecorator],
  // Reset mock to default before each story.
  args: {
    isOpen: true,
    onClose: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof AboutModal>;

/** Stable release, up to date. */
export const Default: Story = {
  decorators: [
    (Story) => {
      setMockAppInfo(
        partialModelFixture<backend.AppInfo>({
          version: '1.3.13',
          buildTime: '2026-03-14T00:00:00Z',
          gitCommit: 'abc1234',
          isBeta: false,
          update: partialModelFixture<backend.UpdateInfo>({
            status: Status.StatusCurrent,
            currentVersion: '1.3.13',
            canCheck: true,
            canInstall: true,
            distribution: Distribution.DistributionMacBundle,
          }),
        })
      );
      return <Story />;
    },
  ],
};

const RELEASE_NOTES = [
  '### Added',
  '',
  '- **Real multi-window support.** Wails v3 includes proper support for multiple app windows.',
  '- **Auto-updates.** The app now checks for new releases and lets you perform an in-place upgrade.',
  '',
  '### Fixed',
  '',
  '- Namespace list no longer dims when workloads are present.',
  '- Pods tab no longer renders empty on first visit.',
].join('\n');

const withUpdate = (
  update: Partial<backend.UpdateInfo>,
  backendOverrides: Record<string, (...args: unknown[]) => unknown> = {}
) => [
  (Story: React.ComponentType) => {
    window.__storybookBackendOverrides ||= {};
    Object.assign(window.__storybookBackendOverrides, backendOverrides);
    setMockAppInfo(
      partialModelFixture<backend.AppInfo>({
        version: '1.3.13',
        buildTime: '2026-03-14T00:00:00Z',
        gitCommit: 'abc1234',
        isBeta: false,
        update: partialModelFixture<backend.UpdateInfo>({
          currentVersion: '1.3.13',
          canCheck: true,
          canInstall: true,
          distribution: Distribution.DistributionMacBundle,
          ...update,
        }),
      })
    );
    return <Story />;
  },
];

/** Shows an authenticated update awaiting explicit download consent. */
export const UpdateAvailable: Story = {
  decorators: withUpdate({
    status: Status.StatusAvailable,
    availableVersion: '2.0.0',
    releaseName: 'Luxury Yacht 2.0.0',
    publishedAt: '2026-08-14T12:30:00Z',
    releaseNotes: RELEASE_NOTES,
  }),
};

/** A release suppressed from automatic prompts, with an explicit way to remove the skip. */
export const VersionSkipped: Story = {
  decorators: withUpdate(
    {
      status: Status.StatusSkipped,
      availableVersion: '2.0.0',
    },
    {
      RemoveApplicationUpdateSkip: () =>
        Promise.resolve(
          partialModelFixture<backend.UpdateInfo>({
            status: Status.StatusAvailable,
            currentVersion: '1.3.13',
            availableVersion: '2.0.0',
            canCheck: true,
            canInstall: true,
            distribution: Distribution.DistributionMacBundle,
          })
        ),
    }
  ),
};

/** Download in flight, with the notes still readable beside the progress bar. */
export const UpdateDownloading: Story = {
  decorators: withUpdate({
    status: Status.StatusDownloading,
    availableVersion: '2.0.0',
    releaseName: 'Luxury Yacht 2.0.0',
    publishedAt: '2026-08-14T12:30:00Z',
    releaseNotes: RELEASE_NOTES,
    progressPercent: 42,
  }),
};

/** Staged and awaiting the separate restart consent. */
export const UpdateReady: Story = {
  decorators: withUpdate({
    status: Status.StatusReady,
    availableVersion: '2.0.0',
    releaseName: 'Luxury Yacht 2.0.0',
    publishedAt: '2026-08-14T12:30:00Z',
    releaseNotes: RELEASE_NOTES,
  }),
};

/** Discovered but not installable here — recovery copy replaces the download. */
export const UpdateNotInstallable: Story = {
  decorators: withUpdate({
    status: Status.StatusAvailable,
    availableVersion: '2.0.0',
    releaseName: 'Luxury Yacht 2.0.0',
    publishedAt: '2026-08-14T12:30:00Z',
    releaseNotes: RELEASE_NOTES,
    canInstall: false,
    eligibilityReason: EligibilityReason.ReasonLinuxPackageManaged,
    recoveryTarget: RecoveryTarget.RecoveryLinuxPackages,
  }),
};

/** A failed check: error band, no release block, retry action. */
export const UpdateCheckFailed: Story = {
  decorators: withUpdate({
    status: Status.StatusCheckError,
    error: 'network unavailable',
  }),
};

/** Beta build with an expiry date shown. */
export const BetaWithExpiry: Story = {
  decorators: [
    (Story) => {
      setMockAppInfo(
        partialModelFixture<backend.AppInfo>({
          version: '2.0.0-beta.1',
          buildTime: '2026-03-14T00:00:00Z',
          gitCommit: 'def5678',
          isBeta: true,
          expiryDate: '2026-06-01T00:00:00Z',
          update: partialModelFixture<backend.UpdateInfo>({
            status: Status.StatusCurrent,
            currentVersion: '2.0.0-beta.1',
            canCheck: true,
            canInstall: true,
            distribution: Distribution.DistributionMacBundle,
          }),
        })
      );
      return <Story />;
    },
  ],
};
