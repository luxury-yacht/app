import type { resourcemodel } from '@core/backend-api/models';
import type { ResolvedObjectReference } from '@shared/utils/objectIdentity';
import {
  resolveCatalogObjectByUID,
  resourceLinkToObjectReference,
} from '@shared/utils/resourceLinkIdentity';
import { useEffect, useState } from 'react';

// A versionless relationship can become openable when the catalog knows its exact UID.
export function useResourceLinkReference(
  link: resourcemodel.ResourceLink | null | undefined,
  clusterName?: string
): ResolvedObjectReference | undefined {
  const direct = resourceLinkToObjectReference(link, clusterName);
  const hasDirect = Boolean(direct);
  const clusterId = link?.display?.clusterId;
  const uid = link?.display?.uid;
  const key = JSON.stringify([clusterId, uid]);
  const [resolved, setResolved] = useState<{
    key: string;
    reference: ResolvedObjectReference | undefined;
  }>();

  useEffect(() => {
    if (hasDirect || !clusterId || !uid) {
      return;
    }
    let active = true;
    const publish = (nextReference: ResolvedObjectReference | undefined) => {
      if (active) {
        setResolved({ key, reference: nextReference });
      }
    };
    // Missing or unavailable catalog entries remain display-only; never infer a GVK.
    void resolveCatalogObjectByUID(clusterId, uid).then(publish, () => publish(undefined));
    return () => {
      active = false;
    };
  }, [hasDirect, clusterId, uid, key]);

  const reference = resolved?.key === key ? resolved.reference : undefined;
  return direct ?? (reference ? { ...reference, clusterName } : undefined);
}
