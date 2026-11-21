/**
 * frontend/src/modules/object-panel/apiResource/ApiResourceDetails.tsx
 *
 * The kind panel's Details tab: what API discovery reports about a kind, and
 * the state shown while the kind's row is loading, failed, or gone.
 */

import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { failureMessage, type RefreshFailure } from '@/core/refresh/refreshFailure';
import type { ClusterAPIResourceEntry } from '@/core/refresh/types';
import { OverviewItem } from '../components/ObjectPanel/Details/Overview/shared/OverviewItem';
import '../components/ObjectPanel/Details/Overview/shared/OverviewBlocks.css';

const list = (values: readonly string[] | null | undefined) =>
  values?.length ? values.join(', ') : '-';

/** Shown in place of a tab's content while the panel has no row for its kind. */
export function ApiResourceUnavailable({
  loaded,
  error,
}: Readonly<{ loaded: boolean; error: RefreshFailure | null | undefined }>) {
  if (error) {
    return (
      <div className="details-content">
        <div className="error-message" role="alert">
          Error loading kind details:{' '}
          <ErrorSurface kind="reported" message={failureMessage(error)} />
        </div>
      </div>
    );
  }
  return (
    <div className="details-content">
      {loaded ? (
        <p className="object-panel-empty-state">The cluster no longer serves this kind.</p>
      ) : (
        <LoadingSpinner message="Loading kind details..." />
      )}
    </div>
  );
}

export function ApiResourceDetails({ details }: Readonly<{ details: ClusterAPIResourceEntry }>) {
  return (
    <div className="details-content">
      <div className="object-panel-section">
        <div className="object-panel-section-title">Overview</div>
        <div className="object-panel-section-grid">
          <OverviewItem label="Scope" value={details.scope} />
          <OverviewItem label="Type" value={details.type || '-'} />
          <OverviewItem label="Group" value={details.group || 'core'} />
          <OverviewItem label="Versions" value={list(details.versions)} />
          <OverviewItem label="Plural" value={details.resource} />
          <OverviewItem label="Singular" value={details.singular || '-'} />
          <OverviewItem label="Short names" value={list(details.shortNames)} />
          <OverviewItem label="Categories" value={list(details.categories)} />
          <OverviewItem label="Verbs" value={list(details.verbs)} fullWidth />
        </div>
      </div>
    </div>
  );
}
