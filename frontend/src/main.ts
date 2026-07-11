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
import App from './App.tsx';

const appElement = document.getElementById('app');
if (appElement) {
  const bootstrap = async () => {
    // Hydrate preferences before the first render so paused/loading UI starts
    // from the persisted settings instead of a temporary default state.
    await hydrateAppPreferences();
    initializeScrollbarActivityTracking();
    initializeAutoRefresh();

    const root = ReactDOM.createRoot(appElement);
    root.render(React.createElement(React.StrictMode, null, React.createElement(App, null)));
  };

  void bootstrap();
}
