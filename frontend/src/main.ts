/**
 * frontend/src/main.ts
 *
 * Module source for main.
 * Implements main logic for the frontend.
 */

import { failPanelWindowTransfer } from '@/core/panel-windows';
import { createReactRootErrorHandlers } from '@/core/telemetry/sentry';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  createWindowPreparation,
  disposeWindowPreparation,
  loadWindowRoot,
  type OpeningPanelTransfer,
  prepareWindow,
  renderWindowRoot,
} from './windowBootstrap';

const sentryRuntimeConfig = {
  enabled: __SENTRY_ENABLED__,
  dsn: __SENTRY_FRONTEND_DSN__,
  environment: 'production',
  release: __SENTRY_RELEASE__,
};

const appElement = document.getElementById('app');
if (appElement) {
  const bootstrap = async () => {
    const preparation = createWindowPreparation();
    try {
      const { errorReportingAvailable, descriptor } = await prepareWindow(
        sentryRuntimeConfig,
        preparation
      );
      const rootElement = await loadWindowRoot(descriptor);
      renderWindowRoot(
        appElement,
        rootElement,
        createReactRootErrorHandlers(errorReportingAvailable)
      );
    } catch (error) {
      disposeWindowPreparation(preparation);
      await abortOpeningPanel(preparation.openingPanel);
      const message = document.createElement('p');
      message.textContent = preparation.openingPanel
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

async function abortOpeningPanel(openingPanel: OpeningPanelTransfer | undefined): Promise<void> {
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
}
