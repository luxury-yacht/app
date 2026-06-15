/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/HelmOverview.tsx
 */

import React from 'react';
import { helm } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { buildRequiredRelatedObjectReference } from '@shared/utils/objectIdentity';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import './shared/LabelsAndAnnotations.css';
import './HelmOverview.css';

interface HelmOverviewProps {
  helmReleaseDetails?: helm.HelmReleaseDetails | null;
  // Fallback props for when details aren't loaded yet (from table data)
  name?: string;
  namespace?: string;
  age?: string;
  chart?: string;
  appVersion?: string;
  status?: string;
  statusPresentation?: string;
  revision?: number;
  updated?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export const HelmOverview: React.FC<HelmOverviewProps> = ({
  helmReleaseDetails,
  // Fallback props
  name,
  namespace,
  age,
  chart,
  appVersion,
  status,
  statusPresentation,
  revision,
  updated,
  labels,
  annotations,
}) => {
  const { objectData } = useObjectPanel();
  const clusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };

  // Use details if available, otherwise fall back to table data
  const displayName = helmReleaseDetails?.name || name || '-';
  const displayNamespace = helmReleaseDetails?.namespace || namespace || '-';
  const displayAge = helmReleaseDetails?.age || age || '-';
  const displayChart = helmReleaseDetails?.chart || chart || '-';
  const displayAppVersion = helmReleaseDetails?.appVersion || appVersion;
  const displayStatus = helmReleaseDetails?.status || status;
  const displayStatusPresentation = helmReleaseDetails?.statusPresentation || statusPresentation;
  const displayRevision = helmReleaseDetails?.revision || revision;
  const displayUpdated = helmReleaseDetails?.updated || updated;
  const displayLabels = helmReleaseDetails?.labels || labels;
  const displayAnnotations = helmReleaseDetails?.annotations || annotations;

  return (
    <>
      <ResourceHeader
        kind="HelmRelease"
        name={displayName}
        namespace={displayNamespace}
        age={displayAge}
      />
      <ResourceStatus
        status={displayStatus}
        statusState={helmReleaseDetails?.statusState}
        statusPresentation={displayStatusPresentation}
      />

      {/* Chart Information */}
      {displayChart && <OverviewItem label="Chart" value={displayChart} />}
      {helmReleaseDetails?.version && (
        <OverviewItem label="Chart Version" value={helmReleaseDetails.version} />
      )}
      {displayAppVersion && <OverviewItem label="App Version" value={displayAppVersion} />}
      {displayRevision !== undefined && (
        <OverviewItem label="Revision" value={displayRevision.toString()} />
      )}
      {displayUpdated && <OverviewItem label="Last Updated" value={displayUpdated} />}

      {/* Description */}
      {helmReleaseDetails?.description && (
        <OverviewItem label="Description" value={helmReleaseDetails.description} />
      )}

      {/* Separator before additional sections */}
      {(helmReleaseDetails?.resources && helmReleaseDetails.resources.length > 0) ||
      (helmReleaseDetails?.history && helmReleaseDetails.history.length > 0) ||
      helmReleaseDetails?.notes ? (
        <div className="metadata-section-separator" />
      ) : null}

      {/* Managed Resources */}
      {helmReleaseDetails?.resources && helmReleaseDetails.resources.length > 0 && (
        <div className="metadata-section">
          <div className="metadata-label">Managed Resources</div>
          <div className="metadata-pairs">
            {helmReleaseDetails.resources
              .sort((a: helm.HelmResource, b: helm.HelmResource) => a.kind.localeCompare(b.kind))
              .map((resource: helm.HelmResource, idx: number) => {
                const resourceRef = (() => {
                  const scope = (resource.scope ?? '').trim().toLowerCase();
                  if (scope !== 'cluster' && scope !== 'namespaced') {
                    return null;
                  }
                  try {
                    return buildRequiredRelatedObjectReference({
                      kind: resource.kind,
                      // Prefer the manifest apiVersion so CRD-backed
                      // managed resources keep their real GVK.
                      apiVersion: resource.apiVersion,
                      name: resource.name,
                      namespace: scope === 'namespaced' ? resource.namespace : undefined,
                      ...clusterMeta,
                    });
                  } catch {
                    return null;
                  }
                })();

                return (
                  <div
                    key={`${resource.kind}-${resource.namespace ?? ''}-${resource.name}-${idx}`}
                    className="metadata-pair"
                  >
                    <span className="metadata-key">{resource.kind}:</span>
                    {resourceRef ? (
                      <ObjectPanelLink
                        className="metadata-value"
                        objectRef={resourceRef}
                        title={`Click to view ${resource.kind}: ${resource.name}`}
                      >
                        {resource.namespace
                          ? `${resource.namespace}/${resource.name}`
                          : resource.name}
                      </ObjectPanelLink>
                    ) : (
                      <span className="metadata-value">
                        {resource.namespace
                          ? `${resource.namespace}/${resource.name}`
                          : resource.name}
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Release History */}
      {helmReleaseDetails?.history && helmReleaseDetails.history.length > 0 && (
        <div className="metadata-section">
          <div className="metadata-label">Release History</div>
          <div className="metadata-pairs">
            {helmReleaseDetails.history.slice(0, 5).map((h: helm.HelmRevision) => (
              <div key={`history-${h.revision}`} className="metadata-pair helm-history-item">
                <div className="helm-history-header">
                  <span className="metadata-key">Revision {h.revision}:</span>
                  <span className="metadata-value helm-history-value">
                    <span className={backendStatusTextClass(h.statusPresentation)}>
                      {h.status || '-'}
                    </span>
                    <span>
                      {h.updated} - {h.chart}
                    </span>
                  </span>
                </div>
                {h.description && (
                  <div className="metadata-value helm-history-description">{h.description}</div>
                )}
              </div>
            ))}
            {helmReleaseDetails.history.length > 5 && (
              <div className="metadata-pair">
                <span className="metadata-value helm-history-more">
                  ... and {helmReleaseDetails.history.length - 5} more revision(s)
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Release Notes */}
      {helmReleaseDetails?.notes && (
        <div className="metadata-section">
          <div className="metadata-label">Release Notes</div>
          <div className="metadata-pairs">
            <div className="metadata-pair">
              <pre className="metadata-value helm-release-notes">{helmReleaseDetails.notes}</pre>
            </div>
          </div>
        </div>
      )}

      {/* Labels and Annotations */}
      <ResourceMetadata labels={displayLabels} annotations={displayAnnotations} />
    </>
  );
};
