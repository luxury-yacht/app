/**
 * Storybook decorator that wraps stories in AppearanceModeProvider.
 * Required by components using useAppearanceMode.
 */

import type { Decorator } from '@storybook/react';
import { AppearanceModeProvider } from '@/core/contexts/AppearanceModeContext';

export const AppearanceModeProviderDecorator: Decorator = (Story) => (
  <AppearanceModeProvider>
    <Story />
  </AppearanceModeProvider>
);
