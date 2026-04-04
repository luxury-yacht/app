/**
 * Storybook decorator that wraps stories in KubeconfigProvider.
 * Required by components using useKubeconfig.
 */

import type { Decorator } from '@storybook/react';
import { KubeconfigProvider } from '@modules/kubernetes/config/KubeconfigContext';

export const KubeconfigProviderDecorator: Decorator = (Story) => (
  <KubeconfigProvider>
    <Story />
  </KubeconfigProvider>
);
