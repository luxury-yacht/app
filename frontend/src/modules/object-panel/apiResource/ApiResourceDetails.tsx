/**
 * frontend/src/modules/object-panel/apiResource/ApiResourceDetails.tsx
 *
 * The kind panel's Details tab: what API discovery reports about a kind.
 */

import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { failureMessage } from '@/core/refresh/refreshFailure';
import { OverviewItem } from '../components/ObjectPanel/Details/Overview/shared/OverviewItem';
import type { ApiResourcePanelRef } from '../panelTarget';
import { useApiResourceDetails } from './useApiResourceDetails';
import '../components/ObjectPanel/Details/Overview/shared/OverviewBlocks.css';

const list = (values: readonly string[] | null | undefined) =>
  values?.length ? values.join(', ') : '-';

export function ApiResourceDetails({
  kind,
  enabled,
}: Readonly<{ kind: ApiResourcePanelRef; enabled: boolean }>) {
  const query = useApiResourceDetails(kind, enabled);
  const details = query.rows[0];

  if (query.error) {
    return (
      <div className="details-content">
        <div className="error-message" role="alert">
          Error loading kind details:{' '}
          <ErrorSurface kind="reported" message={failureMessage(query.error)} />
        </div>
      </div>
    );
  }
  if (!details) {
    return (
      <div className="details-content">
        {query.loaded ? (
          <p className="object-panel-empty-state">The cluster no longer serves this kind.</p>
        ) : (
          <LoadingSpinner message="Loading kind details..." />
        )}
      </div>
    );
  }
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
