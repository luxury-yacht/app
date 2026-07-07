/**
 * frontend/src/shared/components/kubernetes/ResourceHeader.tsx
 *
 * UI component for ResourceHeader.
 * Handles rendering and interactions for the shared components.
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { LiveAgeText } from '@shared/components/LiveAgeText';

interface ResourceHeaderProps {
  kind: string;
  name: string;
  namespace?: string;
  displayKind?: string; // Optional override for display
}

export const ResourceHeader: React.FC<ResourceHeaderProps> = ({
  kind,
  name,
  namespace,
  displayKind,
}) => {
  const { objectData, creationTimestamp, lastModified } = useObjectPanel();

  return (
    <>
      <OverviewItem label="Kind" value={displayKind || kind} />
      <OverviewItem label="Name" value={name} />
      {namespace && (
        <OverviewItem
          label="Namespace"
          value={
            <ObjectPanelLink
              objectRef={buildRequiredObjectReference({
                kind: 'Namespace',
                name: namespace,
                clusterId: objectData?.clusterId ?? undefined,
                clusterName: objectData?.clusterName ?? undefined,
              })}
              // Alt-click reveals the object currently open in the panel (which
              // also selects this namespace in the sidebar), rather than
              // routing to the Namespace kind's own view. Plain click still
              // opens the Namespace object.
              navigateRef={objectData ?? undefined}
            >
              {namespace}
            </ObjectPanelLink>
          }
        />
      )}
      {creationTimestamp && (
        <OverviewItem label="Age" value={<LiveAgeText timestamp={creationTimestamp} />} />
      )}
      {/* Last spec/metadata change (managedFields-derived); omitted when the
          backend can't determine it. Same relative format as Age. */}
      {lastModified && <OverviewItem label="Last Modified" value={lastModified} />}
      <div className="overview-separator" aria-hidden="true" />
    </>
  );
};
