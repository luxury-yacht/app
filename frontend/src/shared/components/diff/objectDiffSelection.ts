import type { ObjectIdentityInput } from '@shared/utils/objectIdentity';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';

/**
 * Generic diff/open workflows should preserve the same identity backbone as
 * object-panel opening and catalog rows. uid/resource/clusterName stay
 * optional so typed views can still participate without pretending they are
 * full catalog rows.
 */
export interface ObjectDiffSelectionSeed {
  clusterId: string;
  clusterName?: string;
  namespace?: string;
  group: string;
  version: string;
  kind: string;
  name: string;
  resource?: string;
  uid?: string;
}

export const buildObjectDiffSelection = (
  input: ObjectIdentityInput
): ObjectDiffSelectionSeed | null => {
  try {
    const ref = buildRequiredObjectReference(input);
    const clusterId = ref.clusterId;
    if (!clusterId) {
      return null;
    }

    return {
      clusterId,
      clusterName: ref.clusterName,
      namespace: ref.namespace,
      group: ref.group,
      version: ref.version,
      kind: ref.kind,
      name: ref.name,
      resource: ref.resource,
      uid: ref.uid,
    };
  } catch {
    return null;
  }
};

export interface ObjectDiffOpenRequest {
  requestId: number;
  left?: ObjectDiffSelectionSeed | null;
}
