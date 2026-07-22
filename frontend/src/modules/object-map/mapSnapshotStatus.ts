/**
 * frontend/src/modules/object-map/mapSnapshotStatus.ts
 *
 * Shared loading predicate for object-map snapshot domain state, used by both
 * map render surfaces (namespace map view and the object-panel Map tab).
 * Typed against DomainStatus so a renamed status is a compile error here
 * instead of a silently-never-true comparison.
 */

import type { DomainStatus } from '@core/refresh/store';

/**
 * True while a fetch is (or may be) in flight, including background updates
 * of an already-rendered map. Callers must combine this with a
 * payload-presence check (`isMapSnapshotLoading(status) && !payload`) to show
 * a loading state only before the first payload arrives.
 */
export const isMapSnapshotLoading = (status: DomainStatus): boolean =>
  status === 'idle' || status === 'loading' || status === 'initialising' || status === 'updating';
