/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Explain/definedKind.ts
 *
 * The kind a CustomResourceDefinition defines, as the Explain tab reads it.
 */

import type { KindReadTarget } from '@/core/data-access';
import type { ObjectDetail } from '@/core/refresh/types';

/**
 * Returns the custom kind at the preferred served version in its CRD details.
 */
export function definedKindOf(
  clusterId: string,
  detail: ObjectDetail | null | undefined
): KindReadTarget | null {
  if (detail?.detailType !== 'customresourcedefinition') {
    return null;
  }
  const { group, names, preferredVersion } = detail.details;
  if (!clusterId || !group || !preferredVersion || !names?.plural || !names.kind) {
    return null;
  }
  return { clusterId, group, version: preferredVersion, kind: names.kind, resource: names.plural };
}
