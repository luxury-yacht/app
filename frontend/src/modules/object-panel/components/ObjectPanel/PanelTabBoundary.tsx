import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { type ReactNode, Suspense } from 'react';

const tabErrorFallback = (tabName: string) => (_error: Error, reset: () => void) => (
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
  <ErrorBoundary scope={scope} resetKeys={resetKeys} fallback={tabErrorFallback(tabName)}>
    <Suspense fallback={<LoadingSpinner message={`Loading ${loadingName}...`} />}>
      {children}
    </Suspense>
  </ErrorBoundary>
);
