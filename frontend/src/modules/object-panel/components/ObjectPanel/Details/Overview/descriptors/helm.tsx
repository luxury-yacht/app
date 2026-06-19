/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/helm.tsx
 *
 * HelmRelease Overview descriptor (X1). Presentation ported verbatim from HelmOverview.tsx.
 */

import React from 'react';
import { helm } from '@wailsjs/go/models';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { buildRequiredRelatedObjectReference } from '@shared/utils/objectIdentity';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import type { OverviewDescriptor } from '../schema';
import '../shared/LabelsAndAnnotations.css';
import '../HelmOverview.css';

type HelmReleaseDetails = helm.HelmReleaseDetails;

// Number of recent revisions shown before collapsing the rest into a "more" line.
const HISTORY_LIMIT = 5;

const hasResources = (d: HelmReleaseDetails) => (d.resources?.length ?? 0) > 0;
const hasHistory = (d: HelmReleaseDetails) => (d.history?.length ?? 0) > 0;
const hasNotes = (d: HelmReleaseDetails) => Boolean(d.notes);
const hasExtraSections = (d: HelmReleaseDetails) => hasResources(d) || hasHistory(d) || hasNotes(d);

/**
 * Managed resources, release history, and release notes. Rendered as a component (not a plain
 * helper) because the managed-resource links need the active cluster identity from the object
 * panel context to build fully-qualified object references.
 */
const HelmExtraSections: React.FC<{ data: HelmReleaseDetails }> = ({ data }) => {
  const { objectData } = useObjectPanel();
  const clusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };

  return (
    <>
      {/* Separator before additional sections */}
      {hasExtraSections(data) ? <div className="metadata-section-separator" /> : null}

      {/* Managed Resources */}
      {data.resources && data.resources.length > 0 && (
        <div className="metadata-section">
          <div className="metadata-label">Managed Resources</div>
          <div className="metadata-pairs">
            {data.resources
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
      {data.history && data.history.length > 0 && (
        <div className="metadata-section">
          <div className="metadata-label">Release History</div>
          <div className="metadata-pairs">
            {data.history.slice(0, HISTORY_LIMIT).map((h: helm.HelmRevision) => (
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
            {data.history.length > HISTORY_LIMIT && (
              <div className="metadata-pair">
                <span className="metadata-value helm-history-more">
                  ... and {data.history.length - HISTORY_LIMIT} more revision(s)
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Release Notes */}
      {data.notes && (
        <div className="metadata-section">
          <div className="metadata-label">Release Notes</div>
          <div className="metadata-pairs">
            <div className="metadata-pair">
              <pre className="metadata-value helm-release-notes">{data.notes}</pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const helmReleaseDescriptor: OverviewDescriptor<HelmReleaseDetails> = {
  displayKind: 'HelmRelease',
  dtoClass: helm.HelmReleaseDetails,
  schema: {
    items: [
      { field: 'chart', label: 'Chart', hidden: (d) => !d.chart },
      { kind: 'status' },
      { field: 'version', label: 'Chart Version', hidden: (d) => !d.version },
      { field: 'appVersion', label: 'App Version', hidden: (d) => !d.appVersion },
      {
        field: 'revision',
        label: 'Revision',
        // Mirror the legacy `displayRevision || revision` truthiness check: a falsy revision
        // (0 or unset) was never surfaced. The renderer evaluates `render` before `hidden`, so the
        // value access must itself tolerate the missing case.
        hidden: (d) => !d.revision,
        render: (d) => (d.revision ? d.revision.toString() : undefined),
      },
      { field: 'updated', label: 'Last Updated', hidden: (d) => !d.updated },
      { field: 'description', label: 'Description', hidden: (d) => !d.description },
      {
        kind: 'widget',
        consumes: ['resources', 'history', 'notes'],
        render: (d) => <HelmExtraSections data={d} />,
      },
    ],
  },
  // typeAlias is an internal table-summary alias and `values` (raw chart values) is not surfaced in
  // the Overview.
  coveredElsewhere: ['typeAlias', 'values'],
};
