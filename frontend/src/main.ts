/**
 * frontend/src/main.ts
 *
 * Module source for main.
 * Implements main logic for the frontend.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { initializeAutoRefresh, initializeMetricsRefreshInterval } from '@/core/refresh';
import { hydrateAppPreferences } from '@/core/settings/appPreferences';

const appElement = document.getElementById('app');
if (appElement) {
  const bootstrap = async () => {
    // Hydrate preferences before the first render so paused/loading UI starts
    // from the persisted settings instead of a temporary default state.
    await hydrateAppPreferences();
    initializeMetricsRefreshInterval();
    initializeAutoRefresh();

    const root = ReactDOM.createRoot(appElement);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App, null)));
  };

  void bootstrap();
}
