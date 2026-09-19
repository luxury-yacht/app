/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/helm.tsx
 *
 * HelmRelease Overview descriptor (X1). Presentation ported verbatim from HelmOverview.tsx.
 */

import type { helm } from '@core/backend-api/models';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { buildRequiredRelatedObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import '../shared/LabelsAndAnnotations.css';
import '../HelmOverview.css';

type HelmReleaseDetails = helm.HelmReleaseDetails;

// Number of recent revisions shown before collapsing the rest into a "more" line.
const HISTORY_LIMIT = 5;

const hasResources = (d: HelmReleaseDetails) => (d.resources?.length ?? 0) > 0;
const hasHistory = (d: HelmReleaseDetails) => (d.history?.length ?? 0) > 0;
const hasNotes = (d: HelmReleaseDetails) => Boolean(d.notes);
const hasExtraSections = (d: HelmReleaseDetails) => hasResources(d) || hasHistory(d) || hasNotes(d);

const managedResourceReference = (resource: helm.HelmResource, context: OverviewContext) => {
  const scope = (resource.scope ?? '').trim().toLowerCase();
  if (scope !== 'cluster' && scope !== 'namespaced') {
    return null;
  }
  try {
    return buildRequiredRelatedObjectReference({
      kind: resource.kind,
      apiVersion: resource.apiVersion,
      name: resource.name,
      namespace: scope === 'namespaced' ? resource.namespace : undefined,
      clusterId: context.clusterId,
      clusterName: context.clusterName,
    });
  } catch {
    return null;
  }
};

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
            {withStableListKeys(
              [...data.resources].sort((a: helm.HelmResource, b: helm.HelmResource) =>
                a.kind.localeCompare(b.kind)
              ),
              (resource) => JSON.stringify(resource)
            ).map(({ key, value: resource }) => {
              const resourceRef = managedResourceReference(resource, clusterMeta);
              const label = resource.namespace
                ? `${resource.namespace}/${resource.name}`
                : resource.name;

              return (
                <div key={key} className="metadata-pair">
                  <span className="metadata-key">{resource.kind}:</span>
                  {resourceRef ? (
                    <ObjectPanelLink
                      className="metadata-value"
                      objectRef={resourceRef}
                      title={`Click to view ${resource.kind}: ${resource.name}`}
                    >
                      {label}
                    </ObjectPanelLink>
                  ) : (
                    <span className="metadata-value">{label}</span>
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
                {!!h.description && (
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
      {!!data.notes && (
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
  dtoName: 'HelmReleaseDetails',
  schema: {
    items: [
      { field: 'chart', label: 'Chart', hidden: (d) => !d.chart },
      { kind: 'status' },
      { field: 'version', label: 'Chart Version', hidden: (d) => !d.version },
      { field: 'appVersion', label: 'App Version', hidden: (d) => !d.appVersion },
      {
        field: 'revision',
        label: 'Revision',
        // Zero or unset revisions stay hidden.
        hidden: (d) => !d.revision,
        render: (d) => d.revision.toString(),
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
