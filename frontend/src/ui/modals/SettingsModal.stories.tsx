/**
 * frontend/src/ui/modals/SettingsModal.stories.tsx
 *
 * Storybook stories for the SettingsModal component.
 */

import type { Meta, StoryObj } from '@storybook/react';
import SettingsModal from './SettingsModal';
import { KeyboardProviderDecorator } from '../../../.storybook/decorators/KeyboardProviderDecorator';
import { ThemeProviderDecorator } from '../../../.storybook/decorators/ThemeProviderDecorator';
import { KubeconfigProviderDecorator } from '../../../.storybook/decorators/KubeconfigProviderDecorator';
import { ZoomProviderDecorator } from '../../../.storybook/decorators/ZoomProviderDecorator';
import { setMockSettingsBackend } from '../../../.storybook/mocks/wailsBackendSettings';

const meta: Meta<typeof SettingsModal> = {
  title: 'Modals/SettingsModal',
  component: SettingsModal,
  // Decorators are applied inner-to-outer: Keyboard wraps the component,
  // then Zoom, then Theme, then Kubeconfig (outermost).
  decorators: [
    KeyboardProviderDecorator,
    ZoomProviderDecorator,
    ThemeProviderDecorator,
    KubeconfigProviderDecorator,
  ],
  args: {
    isOpen: true,
    onClose: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SettingsModal>;

/** Default open state with system theme selected. */
export const Default: Story = {
  decorators: [
    (Story) => {
      setMockSettingsBackend({
        themeInfo: { currentTheme: 'dark', userTheme: 'system' },
        kubeconfigSearchPaths: ['~/.kube'],
      });
      return <Story />;
    },
  ],
};

/** Light theme selected. */
export const LightTheme: Story = {
  decorators: [
    (Story) => {
      setMockSettingsBackend({
        themeInfo: { currentTheme: 'light', userTheme: 'light' },
        kubeconfigSearchPaths: ['~/.kube'],
      });
      return <Story />;
    },
  ],
};

/** Dark theme explicitly selected. */
export const DarkTheme: Story = {
  decorators: [
    (Story) => {
      setMockSettingsBackend({
        themeInfo: { currentTheme: 'dark', userTheme: 'dark' },
        kubeconfigSearchPaths: ['~/.kube'],
      });
      return <Story />;
    },
  ],
};

/** Multiple kubeconfig search paths configured. */
export const MultipleKubeconfigPaths: Story = {
  decorators: [
    (Story) => {
      setMockSettingsBackend({
        themeInfo: { currentTheme: 'dark', userTheme: 'system' },
        kubeconfigSearchPaths: ['~/.kube', '/etc/kubernetes', '/opt/clusters/staging'],
      });
      return <Story />;
    },
  ],
};

/** Modal in closed state — should render nothing. */
export const Closed: Story = {
  args: {
    isOpen: false,
  },
};
