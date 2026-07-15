/**
 * frontend/src/modules/namespace/components/AllNamespacesView.tsx
 *
 * Module source for AllNamespacesView.
 * This component renders different views for the "All Namespaces" scope
 * based on the active tab selected by the user. Every tab is query-backed:
 * each table fetches its own page and surfaces its own error/empty states,
 * so there is no shared resource context to read here.
 */

import BrowseView from '@modules/browse/components/BrowseView';
import NsViewAutoscaling from '@modules/namespace/components/NsViewAutoscaling';
import NsViewConfig from '@modules/namespace/components/NsViewConfig';
import NsViewCustom from '@modules/namespace/components/NsViewCustom';
import NsViewEvents from '@modules/namespace/components/NsViewEvents';
import NsViewHelm from '@modules/namespace/components/NsViewHelm';
import NsViewNetwork from '@modules/namespace/components/NsViewNetwork';
import NsViewQuotas from '@modules/namespace/components/NsViewQuotas';
import NsViewRBAC from '@modules/namespace/components/NsViewRBAC';
import NsViewStorage from '@modules/namespace/components/NsViewStorage';
import NsViewWorkloads from '@modules/namespace/components/NsViewWorkloads';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type React from 'react';
import type { NamespaceViewType } from '@/types/navigation/views';

interface AllNamespacesViewProps {
  activeTab: NamespaceViewType;
}

const AllNamespacesView: React.FC<AllNamespacesViewProps> = ({ activeTab }) => {
  const renderContent = () => {
    switch (activeTab) {
      case 'workloads':
        return <NsViewWorkloads namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />;
      case 'config':
        return <NsViewConfig namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />;
      case 'autoscaling':
        return <NsViewAutoscaling namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />;
      case 'network':
        return <NsViewNetwork namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />;
      case 'helm':
        return <NsViewHelm namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />;
      case 'events':
        return <NsViewEvents namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />;
      case 'quotas':
        return <NsViewQuotas namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />;
      case 'rbac':
        return <NsViewRBAC namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />;
      case 'storage':
        return <NsViewStorage namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />;
      case 'custom':
        return <NsViewCustom namespace={ALL_NAMESPACES_SCOPE} showNamespaceColumn />;
      case 'browse':
        return <BrowseView namespace={ALL_NAMESPACES_SCOPE} />;
      case 'map':
        return (
          <div className="namespace-placeholder">
            <p>Map is available for individual namespaces.</p>
          </div>
        );
      default:
        return (
          <div className="namespace-placeholder">
            <p>
              The <strong>{activeTab}</strong> view is not yet available for the "All" namespace.
            </p>
          </div>
        );
    }
  };

  return <div className="view-content">{renderContent()}</div>;
};

export default AllNamespacesView;
