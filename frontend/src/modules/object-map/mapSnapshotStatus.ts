/**
 * frontend/src/modules/object-map/mapSnapshotStatus.ts
 *
 * Shared loading/refreshing predicates for object-map snapshot domain state,
 * used by both map render surfaces (namespace map view and the object-panel
 * Map tab). Typed against DomainStatus so a renamed status is a compile error
 * here instead of a silently-never-true comparison.
 */

import type { DomainStatus } from '@core/refresh/store';

/** No renderable payload yet, or the first load is still in flight. */
export const isMapSnapshotLoading = (status: DomainStatus): boolean =>
  status === 'idle' || status === 'loading' || status === 'initialising' || status === 'updating';

/** A fetch is in flight for an already-rendered map. */
export const isMapSnapshotRefreshing = (status: DomainStatus): boolean =>
  status === 'loading' || status === 'initialising' || status === 'updating';
