/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ConfigMapOverview.tsx
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';

interface ConfigMapOverviewProps {
  configMapDetails: types.ConfigMapDetails | null;
}

export const ConfigMapOverview: React.FC<ConfigMapOverviewProps> = ({ configMapDetails }) => {
  const { objectData } = useObjectPanel();
  const clusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };

  if (!configMapDetails) return null;

  const dataCount = Object.keys(configMapDetails.data || {}).length;
  const binaryDataCount = Object.keys(configMapDetails.binaryData || {}).length;

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader
        kind="ConfigMap"
        name={configMapDetails.name}
        namespace={configMapDetails.namespace}
        age={configMapDetails.age}
      />

      {/* Data counts */}
      {dataCount > 0 && (
        <OverviewItem label="Data Keys" value={`${dataCount} key${dataCount !== 1 ? 's' : ''}`} />
      )}
      {binaryDataCount > 0 && (
        <OverviewItem
          label="Binary Data"
          value={`${binaryDataCount} key${binaryDataCount !== 1 ? 's' : ''}`}
        />
      )}

      {/* Usage information - show actual pod names as links */}
      {configMapDetails.usedBy !== undefined && (
        <OverviewItem
          label="Used By"
          value={
            configMapDetails.usedBy.length === 0 ? (
              <span style={{ color: 'var(--color-text-secondary)' }}>Not in use</span>
            ) : (
              <div>
                {configMapDetails.usedBy.map((podName: string, index: number) => (
                  <div key={`${podName}-${index}`} style={{ marginTop: index > 0 ? '4px' : 0 }}>
                    <ObjectPanelLink
                      objectRef={{
                        kind: 'pod',
                        name: podName,
                        namespace: configMapDetails.namespace,
                        ...clusterMeta,
                      }}
                      title={`Click to view pod: ${podName}`}
                    >
                      {podName}
                    </ObjectPanelLink>
                  </div>
                ))}
              </div>
            )
          }
        />
      )}

      {/* Use composed component for metadata */}
      <ResourceMetadata
        labels={configMapDetails.labels}
        annotations={configMapDetails.annotations}
      />
    </>
  );
};
