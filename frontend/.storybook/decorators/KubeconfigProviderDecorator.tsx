/**
 * Storybook decorator that wraps stories in KubeconfigProvider.
 * Required by components using useKubeconfig.
 */

import { KubeconfigProvider } from '@modules/kubernetes/config/KubeconfigContext';
import type { Decorator } from '@storybook/react';

export const KubeconfigProviderDecorator: Decorator = (Story) => (
  <KubeconfigProvider>
    <Story />
  </KubeconfigProvider>
);
