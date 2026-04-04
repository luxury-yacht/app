/**
 * Storybook decorator that wraps stories in ThemeProvider.
 * Required by components using useTheme.
 */

import type { Decorator } from '@storybook/react';
import { ThemeProvider } from '@/core/contexts/ThemeContext';

export const ThemeProviderDecorator: Decorator = (Story) => (
  <ThemeProvider>
    <Story />
  </ThemeProvider>
);
