/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Explain/definedKind.ts
 *
 * The kind a CustomResourceDefinition defines, as the Explain tab reads it.
 */

import type { KindReadTarget } from '@/core/data-access';
import type { ObjectDetail } from '@/core/refresh/types';

/**
 * Returns the custom kind a CustomResourceDefinition's detail describes, at a
 * version the cluster serves: the stored version when it is served, otherwise
 * the first served one. Null for any other object, or while nothing is served.
 */
export function definedKindOf(
  clusterId: string,
  detail: ObjectDetail | null | undefined
): KindReadTarget | null {
  if (detail?.detailType !== 'customresourcedefinition') {
    return null;
  }
  const { group, names, versions } = detail.details;
  const served = (versions ?? []).filter((candidate) => candidate.served);
  const version = served.find((candidate) => candidate.storage) ?? served[0];
  if (!version || !names?.plural || !names.kind) {
    return null;
  }
  return { clusterId, group, version: version.name, kind: names.kind, resource: names.plural };
}
