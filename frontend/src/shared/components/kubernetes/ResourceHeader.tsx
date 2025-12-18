/**
 * Shared component for displaying resource header information
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';

interface ResourceHeaderProps {
  kind: string;
  name: string;
  namespace?: string;
  age?: string;
  displayKind?: string; // Optional override for display
}

export const ResourceHeader = React.memo<ResourceHeaderProps>(
  ({ kind, name, namespace, age, displayKind }) => {
    return (
      <>
        <OverviewItem label="Kind" value={displayKind || kind} />
        <OverviewItem label="Name" value={name} />
        {namespace && <OverviewItem label="Namespace" value={namespace} />}
        {age && <OverviewItem label="Age" value={age} />}
        <div className="overview-separator" aria-hidden="true" />
      </>
    );
  }
);
