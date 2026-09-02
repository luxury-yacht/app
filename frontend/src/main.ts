/**
 * frontend/src/main.ts
 *
 * Module source for main.
 * Implements main logic for the frontend.
 */

import { initializeScrollbarActivityTracking } from '@shared/scrollbars/scrollbarActivity';
import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { initializeWindowIdentity, onBroadcastEvent } from '@/core/desktop-runtime';
import { failPanelWindowTransfer, resolveNativeWindowDescriptor } from '@/core/panel-windows';
import { initializeAutoRefresh } from '@/core/refresh';
import { hydrateAppPreferences } from '@/core/settings/appPreferences';
import {
  configureErrorReportingFromPreferences,
  createReactRootErrorHandlers,
} from '@/core/telemetry/sentry';
import { setWorkspaceProjectionIdentity } from '@/core/window-identity';
import { reportOperationalError } from '@/utils/errorHandler';

const sentryRuntimeConfig = {
  enabled: __SENTRY_ENABLED__,
  dsn: __SENTRY_FRONTEND_DSN__,
  environment: 'production',
  release: __SENTRY_RELEASE__,
};

const appElement = document.getElementById('app');
if (appElement) {
  const bootstrap = async () => {
    let openingPanel:
      | {
          windowName: string;
          transferId: string;
        }
      | undefined;
    try {
      // Hydrate preferences before the first render so paused/loading UI starts
      // from the persisted settings instead of a temporary default state.
      const { available: errorReportingAvailable } = await configureErrorReportingFromPreferences(
        sentryRuntimeConfig,
        hydrateAppPreferences
      );
      const windowName = await initializeWindowIdentity();
      const descriptor = await resolveNativeWindowDescriptor(windowName);
      if (descriptor.role === 'panel' && descriptor.panel) {
        setWorkspaceProjectionIdentity(descriptor.panel.ownerWindowName);
        if (descriptor.panel.state === 'opening') {
          openingPanel = {
            windowName: descriptor.panel.windowName,
            transferId: descriptor.panel.snapshot.transferId,
          };
        }
      }
      initializeScrollbarActivityTracking();
      initializeAutoRefresh();

      onBroadcastEvent('settings:preferences-changed', () => {
        void hydrateAppPreferences({ force: true })
          .then(() => initializeAutoRefresh())
          .catch((error) => {
            reportOperationalError(error, {
              source: 'ApplicationBootstrap',
              action: 'hydrate-peer-preferences',
            });
          });
      });

      // Imported here rather than at module scope so the application module graph
      // is evaluated after the SDK is initialized. A module-level failure in that
      // graph then rejects this bootstrap and is captured by Sentry's global
      // unhandled-rejection handler instead of crashing an uninstrumented page.
      let rootElement: React.ReactElement;
      if (descriptor.role === 'panel' && descriptor.panel) {
        const PanelWindowRoot = (await import('./PanelWindowApp.tsx')).default;
        rootElement = React.createElement(PanelWindowRoot, { descriptor: descriptor.panel });
      } else {
        const WorkspaceRoot = (await import('./WorkspaceApp.tsx')).default;
        rootElement = React.createElement(WorkspaceRoot);
      }

      const root = ReactDOM.createRoot(
        appElement,
        createReactRootErrorHandlers(errorReportingAvailable)
      );
      root.render(React.createElement(React.StrictMode, null, rootElement));
    } catch (error) {
      if (openingPanel) {
        try {
          await failPanelWindowTransfer(
            openingPanel.windowName,
            openingPanel.windowName,
            openingPanel.transferId
          );
        } catch (transferError) {
          reportOperationalError(transferError, {
            source: 'ApplicationBootstrap',
            action: 'fail-panel-transfer',
          });
        }
      }
      const message = document.createElement('p');
      message.textContent = openingPanel
        ? 'Could not open this panel.'
        : 'Could not open this application window.';
      message.setAttribute('role', 'alert');
      appElement.replaceChildren(message);
      reportOperationalError(error, {
        source: 'ApplicationBootstrap',
        action: 'bootstrap-window',
      });
    }
  };

  void bootstrap();
}
