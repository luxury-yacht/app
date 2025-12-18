import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';

interface SecretOverviewProps {
  secretDetails: types.SecretDetails | null;
}

export const SecretOverview: React.FC<SecretOverviewProps> = ({ secretDetails }) => {
  const { openWithObject } = useObjectPanel();

  if (!secretDetails) return null;

  return (
    <>
      {/* Use composed component for header */}
      <ResourceHeader
        kind="Secret"
        name={secretDetails.name}
        namespace={secretDetails.namespace}
        age={secretDetails.age}
      />

      {/* Secret Type - show prominently for secrets */}
      {secretDetails.secretType && (
        <OverviewItem
          label="Type"
          value={
            <span
              className={`status-badge ${
                secretDetails.secretType === 'kubernetes.io/tls'
                  ? 'info'
                  : secretDetails.secretType === 'kubernetes.io/service-account-token'
                    ? 'system'
                    : secretDetails.secretType === 'kubernetes.io/dockerconfigjson'
                      ? 'registry'
                      : 'default'
              }`}
            >
              {secretDetails.secretType}
            </span>
          }
        />
      )}

      {/* Data keys count */}
      {secretDetails.dataKeys && secretDetails.dataKeys.length > 0 && (
        <OverviewItem
          label="Data Keys"
          value={`${secretDetails.dataKeys.length} key${secretDetails.dataKeys.length !== 1 ? 's' : ''}`}
        />
      )}

      {/* Usage information - show actual pod names as links */}
      {secretDetails.usedBy !== undefined && (
        <OverviewItem
          label="Used By"
          value={
            secretDetails.usedBy.length === 0 ? (
              <span style={{ color: 'var(--color-text-secondary)' }}>Not in use</span>
            ) : (
              <div>
                {secretDetails.usedBy.map((podName: string, index: number) => (
                  <div key={`${podName}-${index}`} style={{ marginTop: index > 0 ? '4px' : 0 }}>
                    <span
                      className="object-panel-link"
                      onClick={() =>
                        openWithObject?.({
                          kind: 'pod',
                          name: podName,
                          namespace: secretDetails.namespace,
                        })
                      }
                      title={`Click to view pod: ${podName}`}
                    >
                      {podName}
                    </span>
                  </div>
                ))}
              </div>
            )
          }
        />
      )}

      {/* Use composed component for metadata */}
      <ResourceMetadata labels={secretDetails.labels} annotations={secretDetails.annotations} />
    </>
  );
};
