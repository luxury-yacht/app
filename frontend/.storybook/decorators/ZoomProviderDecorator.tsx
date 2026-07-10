/**
 * Storybook decorator that wraps stories in ZoomProvider.
 * Required by components using useZoom (e.g., Tooltip).
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import type { Decorator } from '@storybook/react';

export const ZoomProviderDecorator: Decorator = (Story) => (
  <ZoomProvider>
    <Story />
  </ZoomProvider>
);
