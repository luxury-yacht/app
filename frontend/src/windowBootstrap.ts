/**
 * frontend/src/windowBootstrap.ts
 *
 * Prepares a native window before its React root renders: persisted
 * preferences and error reporting, window identity, the native descriptor, and
 * window-level subscriptions. The application entry (main.ts) and the frontend
 * test harness run these same steps in the same order.
 */

import { initializeScrollbarActivityTracking } from '@shared/scrollbars/scrollbarActivity';
import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { initializeWindowIdentity, onBroadcastEvent } from '@/core/desktop-runtime';
import { type NativeWindowDescriptor, resolveNativeWindowDescriptor } from '@/core/panel-windows';
import { hydrateAppPreferences, subscribePreference } from '@/core/settings/appPreferences';
import {
  configureErrorReportingFromPreferences,
  type SentryRuntimeConfig,
} from '@/core/telemetry/sentry';
import { reportOperationalError } from '@/utils/errorHandler';

export interface OpeningPanelTransfer {
  windowName: string;
  transferId: string;
}

/**
 * What a preparation has acquired so far. The caller creates it before the
 * first step, so a failure at any later step can still fail the opening
 * transfer and release the window's subscriptions.
 */
export interface WindowPreparation {
  openingPanel?: OpeningPanelTransfer;
  readonly disposers: Array<() => void>;
}

export interface PreparedWindow {
  errorReportingAvailable: boolean;
  descriptor: NativeWindowDescriptor;
}

export const createWindowPreparation = (): WindowPreparation => ({ disposers: [] });

export const disposeWindowPreparation = (preparation: WindowPreparation): void => {
  preparation.disposers.splice(0).forEach((dispose) => {
    dispose();
  });
};

export const prepareWindow = async (
  config: SentryRuntimeConfig,
  preparation: WindowPreparation
): Promise<PreparedWindow> => {
  // Hydrate preferences before the first render so paused/loading UI starts
  // from the persisted settings instead of a temporary default state.
  const { available } = await configureErrorReportingFromPreferences(
    config,
    hydrateAppPreferences,
    (listener) => subscribePreference('errorReportingEnabled', listener)
  );
  const windowName = await initializeWindowIdentity();
  const descriptor = await resolveNativeWindowDescriptor(windowName);
  if (descriptor.role === 'panel' && descriptor.panel?.state === 'opening') {
    preparation.openingPanel = {
      windowName: descriptor.panel.windowName,
      transferId: descriptor.panel.transferId,
    };
  }
  initializeScrollbarActivityTracking();

  preparation.disposers.push(
    onBroadcastEvent('settings:preferences-changed', () => {
      // Hydration publishes changed preferences, auto-refresh included.
      void hydrateAppPreferences({ force: true }).catch((error) => {
        reportOperationalError(error, {
          source: 'ApplicationBootstrap',
          action: 'hydrate-peer-preferences',
        });
      });
    })
  );
  return { errorReportingAvailable: available, descriptor };
};

/**
 * Imported here rather than at module scope so the application module graph
 * is evaluated after error reporting is configured. A module-level failure in
 * that graph then rejects the bootstrap and is captured by Sentry's global
 * unhandled-rejection handler instead of crashing an uninstrumented page.
 */
export const loadWindowRoot = async (
  descriptor: NativeWindowDescriptor
): Promise<React.ReactElement> => {
  if (descriptor.role === 'panel' && descriptor.panel) {
    const PanelWindowRoot = (await import('./PanelWindowApp.tsx')).default;
    return React.createElement(PanelWindowRoot, { descriptor: descriptor.panel });
  }
  const WorkspaceRoot = (await import('./WorkspaceApp.tsx')).default;
  return React.createElement(WorkspaceRoot);
};

export const renderWindowRoot = (
  container: Element,
  rootElement: React.ReactElement,
  options: ReactDOM.RootOptions
): ReactDOM.Root => {
  const root = ReactDOM.createRoot(container, options);
  root.render(React.createElement(React.StrictMode, null, rootElement));
  return root;
};
