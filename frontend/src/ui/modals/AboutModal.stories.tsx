/**
 * frontend/src/ui/modals/AboutModal.stories.tsx
 *
 * Storybook stories for the AboutModal component.
 */

import type { Meta, StoryObj } from '@storybook/react';
import AboutModal from './AboutModal';
import { setMockAppInfo } from '../../../.storybook/mocks/wailsBackendApp';
import { backend } from '../../../.storybook/mocks/wailsModels';
import { KeyboardProviderDecorator } from '../../../.storybook/decorators/KeyboardProviderDecorator';

const meta: Meta<typeof AboutModal> = {
  title: 'Modals/AboutModal',
  component: AboutModal,
  decorators: [KeyboardProviderDecorator],
  // Reset mock to default before each story.
  args: {
    isOpen: true,
    onClose: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof AboutModal>;

/** Stable release, up to date. */
export const Default: Story = {
  decorators: [
    (Story) => {
      setMockAppInfo(
        new backend.AppInfo({
          version: '1.3.13',
          buildTime: '2026-03-14T00:00:00Z',
          gitCommit: 'abc1234',
          isBeta: false,
          update: new backend.UpdateInfo({
            currentVersion: '1.3.13',
            latestVersion: '1.3.13',
            releaseUrl: '',
            isUpdateAvailable: false,
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
        new backend.AppInfo({
          version: '1.3.13',
          buildTime: '2026-03-14T00:00:00Z',
          gitCommit: 'abc1234',
          isBeta: false,
          update: new backend.UpdateInfo({
            currentVersion: '1.3.13',
            latestVersion: '2.0.0',
            releaseUrl: 'https://github.com/luxury-yacht/app/releases/tag/v2.0.0',
            isUpdateAvailable: true,
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
        new backend.AppInfo({
          version: '2.0.0-beta.1',
          buildTime: '2026-03-14T00:00:00Z',
          gitCommit: 'def5678',
          isBeta: true,
          expiryDate: '2026-06-01T00:00:00Z',
          update: new backend.UpdateInfo({
            currentVersion: '2.0.0-beta.1',
            latestVersion: '2.0.0-beta.1',
            releaseUrl: '',
            isUpdateAvailable: false,
          }),
        })
      );
      return <Story />;
    },
  ],
};
