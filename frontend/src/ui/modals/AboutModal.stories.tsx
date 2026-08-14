/**
 * frontend/src/ui/modals/AboutModal.stories.tsx
 *
 * Storybook stories for the AboutModal component.
 */

import { Status } from '@bindings/github.com/luxury-yacht/app/backend/internal/appupdates/models';
import { Distribution } from '@bindings/github.com/luxury-yacht/app/internal/updateidentity/models';
import type { backend } from '@core/backend-api/models';
import type { Meta, StoryObj } from '@storybook/react';
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

/** Shows "Update available" with a link to the release page. */
export const UpdateAvailable: Story = {
  decorators: [
    (Story) => {
      setMockAppInfo(
        partialModelFixture<backend.AppInfo>({
          version: '1.3.13',
          buildTime: '2026-03-14T00:00:00Z',
          gitCommit: 'abc1234',
          isBeta: false,
          update: partialModelFixture<backend.UpdateInfo>({
            status: Status.StatusAvailable,
            currentVersion: '1.3.13',
            availableVersion: '2.0.0',
            releaseName: 'Luxury Yacht 2.0.0',
            publishedAt: '2026-08-14T12:30:00Z',
            releaseNotes: 'Automatic updates are now available.',
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
