/**
 * frontend/src/shared/hooks/useConfirmedEmptyNodes.ts
 *
 * Which of the objects a delete is about to remove are nodes that can go without
 * a warning, read from the API server while the confirmation is open. List rows
 * and object details can lag or cover only some namespaces, so they cannot vouch
 * for a node. Until a read says otherwise, a node is not confirmed.
 */

import { lookupObjectActionKindCapability } from '@shared/actions/objectActionCapabilities';
import type { ObjectActionData } from '@shared/actions/objectActionPolicy';
import { forEachWithLimit } from '@shared/utils/forEachWithLimit';
import { useEffect, useState } from 'react';
import { readNodeDrainState, requestData } from '@/core/data-access';

// A few reads at a time keeps a large selection from flooding the API server.
const READS_AT_ONCE = 5;
const NO_NODES: ReadonlySet<ObjectActionData> = new Set();

export const isDrainableNode = (object: ObjectActionData): boolean =>
  Boolean(lookupObjectActionKindCapability(object)?.drain);

const isConfirmedEmpty = async (node: ObjectActionData): Promise<boolean> => {
  const result = await requestData({
    resource: 'node-drain-state',
    reason: 'user',
    read: () => readNodeDrainState(node),
  });
  const state = result.status === 'executed' ? result.data : undefined;
  return state?.cordoned === true && state.evictablePods === 0;
};

/** `objects` must keep its identity while the same confirmation is open. */
export function useConfirmedEmptyNodes(
  objects: readonly ObjectActionData[]
): ReadonlySet<ObjectActionData> {
  const [confirmed, setConfirmed] = useState(NO_NODES);

  useEffect(() => {
    setConfirmed(NO_NODES);
    let cancelled = false;
    void forEachWithLimit(objects.filter(isDrainableNode), READS_AT_ONCE, async (node) => {
      if (cancelled) {
        return;
      }
      // A node that cannot be read stays unconfirmed, so its warning stays up.
      const empty = await isConfirmedEmpty(node).catch(() => false);
      if (empty && !cancelled) {
        setConfirmed((previous) => new Set(previous).add(node));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [objects]);

  return confirmed;
}
