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
import { buildObjectReference } from '@shared/utils/objectIdentity';

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
  const { objectData } = useObjectPanel();

  return (
    <>
      <OverviewItem label="Kind" value={displayKind || kind} />
      <OverviewItem label="Name" value={name} />
      {namespace && (
        <OverviewItem
          label="Namespace"
          value={
            <ObjectPanelLink
              objectRef={buildObjectReference({
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
      <div className="overview-separator" aria-hidden="true" />
    </>
  );
};
