/**
 * frontend/src/main.ts
 *
 * Module source for main.
 * Implements main logic for the frontend.
 */

import { AcknowledgeNamedWorkspaceRestore } from '@/core/backend-api';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { failPanelWindowTransfer } from '@/core/panel-windows';
import { startRendererPage } from '@/core/panel-windows/useRendererReadiness';
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
      startRendererPage(getWindowIdentity());
      const rootElement = await loadWindowRoot(descriptor);
      renderWindowRoot(
        appElement,
        rootElement,
        createReactRootErrorHandlers(errorReportingAvailable)
      );
    } catch (error) {
      // A page that failed to start cannot answer either, and a workspace
      // switch that is waiting for this window to load should stop waiting.
      startRendererPage(getWindowIdentity());
      void AcknowledgeNamedWorkspaceRestore(
        getWindowIdentity(),
        'The window could not start.'
      ).catch(() => undefined);
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
