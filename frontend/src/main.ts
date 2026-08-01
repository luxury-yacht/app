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
import { createReactRootErrorHandlers, initializeErrorReporting } from '@/core/telemetry/sentry';
import App from './App.tsx';

const errorReportingEnabled = initializeErrorReporting({
  enabled: __SENTRY_ENABLED__,
  dsn: __SENTRY_FRONTEND_DSN__,
  environment: 'production',
  release: __SENTRY_RELEASE__,
});

const appElement = document.getElementById('app');
if (appElement) {
  const bootstrap = async () => {
    // Hydrate preferences before the first render so paused/loading UI starts
    // from the persisted settings instead of a temporary default state.
    await hydrateAppPreferences();
    initializeScrollbarActivityTracking();
    initializeAutoRefresh();

    const root = ReactDOM.createRoot(
      appElement,
      createReactRootErrorHandlers(errorReportingEnabled)
    );
    root.render(React.createElement(React.StrictMode, null, React.createElement(App, null)));
  };

  void bootstrap();
}
