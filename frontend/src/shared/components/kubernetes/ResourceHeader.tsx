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

interface ResourceHeaderProps {
  kind: string;
  name: string;
  namespace?: string;
  age?: string;
  displayKind?: string; // Optional override for display
}

export const ResourceHeader: React.FC<ResourceHeaderProps> = ({
  kind,
  name,
  namespace,
  age,
  displayKind,
}) => {
  const { objectData, lastModified } = useObjectPanel();

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
            >
              {namespace}
            </ObjectPanelLink>
          }
        />
      )}
      {age && <OverviewItem label="Age" value={age} />}
      {/* Last spec/metadata change (managedFields-derived); omitted when the
          backend can't determine it. Same relative format as Age. */}
      {lastModified && <OverviewItem label="Last Modified" value={lastModified} />}
      <div className="overview-separator" aria-hidden="true" />
    </>
  );
};
