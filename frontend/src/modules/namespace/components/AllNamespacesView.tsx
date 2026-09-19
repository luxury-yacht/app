/**
 * frontend/src/modules/namespace/components/AllNamespacesView.tsx
 *
 * Module source for AllNamespacesView.
 * This component renders different views for the "All Namespaces" scope
 * based on the active tab selected by the user. Every tab is query-backed:
 * each table fetches its own page and surfaces its own error/empty states,
 * so there is no shared resource context to read here.
 */

import { NAMESPACE_RESOURCE_VIEWS } from './namespaceResourceViews';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type React from 'react';
import type { NamespaceViewType } from '@/types/navigation/views';

interface AllNamespacesViewProps {
  activeTab: NamespaceViewType;
}

const AllNamespacesView: React.FC<AllNamespacesViewProps> = ({ activeTab }) => {
  const renderContent = () => {
    if (activeTab === 'map') {
      return (
        <div className="namespace-placeholder">
          <p>Map is available for individual namespaces.</p>
        </div>
      );
    }
    const view = NAMESPACE_RESOURCE_VIEWS[activeTab];
    if (view) {
      return (
        <view.Component
          namespace={ALL_NAMESPACES_SCOPE}
          showNamespaceColumn={activeTab !== 'browse'}
        />
      );
    }
    return (
      <div className="namespace-placeholder">
        <p>
          The <strong>{activeTab}</strong> view is not yet available for the "All" namespace.
        </p>
      </div>
    );
  };

  return <div className="view-content">{renderContent()}</div>;
};

export default AllNamespacesView;
