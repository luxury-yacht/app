/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ConfigMapOverview.tsx
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { StatusChip } from '@shared/components/StatusChip';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';

interface ConfigMapOverviewProps {
  configMapDetails: types.ConfigMapDetails | null;
}

export const ConfigMapOverview: React.FC<ConfigMapOverviewProps> = ({ configMapDetails }) => {
  if (!configMapDetails) return null;

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader
        kind="ConfigMap"
        name={configMapDetails.name}
        namespace={configMapDetails.namespace}
        age={configMapDetails.age}
      />

      {/* Usage information — always rendered. The backend leaves UsedBy
          nil when no pods reference this ConfigMap (rather than emitting
          an empty array), so undefined here means "not in use" rather than
          "unknown". */}
      <OverviewItem
        label="Used By"
        value={
          !configMapDetails.usedBy || configMapDetails.usedBy.length === 0 ? (
            <StatusChip variant="info">Not in use</StatusChip>
          ) : (
            <div>
              {configMapDetails.usedBy.map((podRef, index) => (
                <div
                  key={`${podRef.clusterId}-${podRef.group}-${podRef.version}-${podRef.kind}-${podRef.namespace ?? ''}-${podRef.name ?? index}`}
                  style={{ marginTop: index > 0 ? '4px' : 0 }}
                >
                  <ObjectPanelLink
                    objectRef={{ ...podRef, group: podRef.group, version: podRef.version }}
                    title={`Click to view pod: ${podRef.name ?? podRef.kind}`}
                  >
                    {podRef.name ?? podRef.kind}
                  </ObjectPanelLink>
                </div>
              ))}
            </div>
          )
        }
      />

      {/* Use composed component for metadata */}
      <ResourceMetadata
        labels={configMapDetails.labels}
        annotations={configMapDetails.annotations}
      />
    </>
  );
};
