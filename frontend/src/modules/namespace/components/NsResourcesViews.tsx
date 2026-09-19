/**
 * frontend/src/modules/namespace/components/NsResourcesViews.tsx
 *
 * Module source for NsResourcesViews.
 * Component that manages namespace resource views
 * - Renders tabs and their corresponding content components
 * - Uses ErrorBoundary to handle errors in each view
 * - Implements a fallback UI for view rendering errors
 * - Each view is declared once in NAMESPACE_RESOURCE_VIEWS; adding a tab is one entry there.
 */

import { ErrorBoundary } from '@shared/components/errors/ErrorBoundary';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import React from 'react';
import type { NamespaceViewType } from '@/types/navigation/views';
import { NAMESPACE_RESOURCE_VIEWS } from './namespaceResourceViews';

const ViewErrorFallback = ({ viewName, reset }: { viewName: string; reset: () => void }) => (
  <div className="namespace-view-error">
    <h4>
      Failed to load <ErrorSurface kind="reported" message={viewName} />
    </h4>
    <p>An error occurred while rendering this view.</p>
    <button type="button" className="button generic" onClick={reset}>
      Retry
    </button>
  </div>
);

interface NamespaceResourcesViewsProps {
  namespace: string;
  activeTab: NamespaceViewType;
}

/**
 * Component that manages namespace resource views
 * Renders tabs and their corresponding content components
 */
const NamespaceResourcesViews: React.FC<NamespaceResourcesViewsProps> = ({
  namespace,
  activeTab,
}) => {
  const view = NAMESPACE_RESOURCE_VIEWS[activeTab];

  return (
    <div className="view-content">
      {view ? (
        <ErrorBoundary
          scope={`namespace-${activeTab}`}
          resetKeys={[namespace]}
          fallback={(_, reset) => <ViewErrorFallback viewName={view.name} reset={reset} />}
        >
          <view.Component namespace={namespace} />
        </ErrorBoundary>
      ) : null}
    </div>
  );
};

export default React.memo(NamespaceResourcesViews);
