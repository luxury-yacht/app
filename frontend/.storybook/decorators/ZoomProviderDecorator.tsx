/**
 * Storybook decorator that wraps stories in ZoomProvider.
 * Required by components using useZoom (e.g., Tooltip).
 */

import type { Decorator } from '@storybook/react';
import { ZoomProvider } from '@core/contexts/ZoomContext';

export const ZoomProviderDecorator: Decorator = (Story) => (
  <ZoomProvider>
    <Story />
  </ZoomProvider>
);
