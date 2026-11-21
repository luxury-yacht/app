/**
 * frontend/src/modules/object-panel/apiResource/ApiResourceDetails.tsx
 *
 * The kind panel's Details tab: what API discovery reports about a kind, and
 * the state shown while the kind's row is loading, failed, or gone.
 */

import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { WarningIcon } from '@shared/components/icons/SharedIcons';
import LoadingSpinner from '@shared/components/LoadingSpinner';
import { failureMessage, type RefreshFailure } from '@/core/refresh/refreshFailure';
import type { ClusterAPIResourceEntry } from '@/core/refresh/types';
import { OverviewItem } from '../components/ObjectPanel/Details/Overview/shared/OverviewItem';
import '../components/ObjectPanel/Details/Overview/shared/OverviewBlocks.css';

const list = (values: readonly string[] | null | undefined) =>
  values?.length ? values.join(', ') : '-';

/**
 * Why the panel has no row for its kind: the cluster has not answered yet, its
 * API discovery could not read the kind's group (so nothing is known about the
 * kind), or it read the group and the kind is not in it.
 */
export type KindAbsence = 'pending' | 'unread' | 'gone';

const ABSENCE_MESSAGES: Record<Exclude<KindAbsence, 'pending'>, string> = {
  unread:
    'This kind’s API group could not be read from the cluster, so its details are unavailable.',
  gone: 'The cluster no longer serves this kind.',
};

/**
 * Shown above a kind's details while the cluster's API discovery cannot read
 * the kind's group: what the panel shows was read before that, and may no
 * longer be what the cluster serves.
 */
export function ApiResourceOutOfDateNotice() {
  return (
    <output className="resource-deleted-warning">
      <WarningIcon />
      <span>
        This kind’s API group could not be read from the cluster. These details are the last ones
        read and may be out of date.
      </span>
    </output>
  );
}

/** Shown in place of a tab's content while the panel has no row for its kind. */
export function ApiResourceUnavailable({
  absence,
  error,
}: Readonly<{ absence: KindAbsence; error: RefreshFailure | null | undefined }>) {
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
      {absence === 'pending' ? (
        <LoadingSpinner message="Loading kind details..." />
      ) : (
        <p className="object-panel-empty-state">{ABSENCE_MESSAGES[absence]}</p>
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
