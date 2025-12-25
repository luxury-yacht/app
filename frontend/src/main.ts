/**
 * frontend/src/main.ts
 *
 * Module source for main.
 * Implements main logic for the frontend.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

const appElement = document.getElementById('app');
if (appElement) {
  const root = ReactDOM.createRoot(appElement);
  root.render(React.createElement(React.StrictMode, null, React.createElement(App, null)));
}
