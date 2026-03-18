/**
 * Storybook decorator that wraps stories in KeyboardProvider.
 * Required by components using useShortcut / useKeyboardContext.
 */

import type { Decorator } from '@storybook/react';
import { KeyboardProvider } from '@ui/shortcuts';

export const KeyboardProviderDecorator: Decorator = (Story) => (
  <KeyboardProvider>
    <Story />
  </KeyboardProvider>
);
