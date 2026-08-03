/**
 * frontend/src/main.ts
 *
 * Module source for main.
 * Implements main logic for the frontend.
 */

import { initializeScrollbarActivityTracking } from '@shared/scrollbars/scrollbarActivity';
import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { initializeAutoRefresh } from '@/core/refresh';
import { hydrateAppPreferences } from '@/core/settings/appPreferences';
import {
  configureErrorReportingFromPreferences,
  createReactRootErrorHandlers,
} from '@/core/telemetry/sentry';

const sentryRuntimeConfig = {
  enabled: __SENTRY_ENABLED__,
  dsn: __SENTRY_FRONTEND_DSN__,
  environment: 'production',
  release: __SENTRY_RELEASE__,
};

const appElement = document.getElementById('app');
if (appElement) {
  const bootstrap = async () => {
    // Hydrate preferences before the first render so paused/loading UI starts
    // from the persisted settings instead of a temporary default state.
    const { available: errorReportingAvailable } = await configureErrorReportingFromPreferences(
      sentryRuntimeConfig,
      hydrateAppPreferences
    );
    initializeScrollbarActivityTracking();
    initializeAutoRefresh();

    // Imported here rather than at module scope so the application module graph
    // is evaluated after the SDK is initialized. A module-level failure in that
    // graph then rejects this bootstrap and is captured by Sentry's global
    // unhandled-rejection handler instead of crashing an uninstrumented page.
    const { default: App } = await import('./App.tsx');

    const root = ReactDOM.createRoot(
      appElement,
      createReactRootErrorHandlers(errorReportingAvailable)
    );
    root.render(React.createElement(React.StrictMode, null, React.createElement(App, null)));
  };

  void bootstrap();
}
