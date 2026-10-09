/**
 * frontend/src/modules/object-panel/components/ObjectPanel/PanelTabBoundary.tsx
 *
 * The recovery and loading policy shared by object-panel tab content: an error
 * boundary with a Retry fallback around a Suspense boundary for lazy tabs.
 */

import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import React, { type ReactNode } from 'react';

const TabErrorFallback = ({ tabName, reset }: { tabName: string; reset: () => void }) => (
  <div className="object-panel-tab-content">
    <div className="object-panel-tab-error">
      <h4>
        Failed to load <ErrorSurface kind="reported" message={tabName} />
      </h4>
      <p>An error occurred while rendering this tab.</p>
      <button type="button" className="button generic" onClick={reset}>
        Retry
      </button>
    </div>
  </div>
);

const createTabErrorFallback = (tabName: string) => (_error: Error, reset: () => void) => (
  <TabErrorFallback tabName={tabName} reset={reset} />
);

// Tab implementations share recovery/loading policy while retaining their own reset keys.
export const PanelTabBoundary = ({
  scope,
  resetKeys,
  tabName,
  loadingName,
  children,
}: {
  scope: string;
  resetKeys?: string[];
  tabName: string;
  loadingName: string;
  children: ReactNode;
}) => (
  <ErrorBoundary scope={scope} resetKeys={resetKeys} fallback={createTabErrorFallback(tabName)}>
    <React.Suspense fallback={<LoadingSpinner message={`Loading ${loadingName}...`} />}>
      {children}
    </React.Suspense>
  </ErrorBoundary>
);
