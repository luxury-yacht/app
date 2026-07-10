import type { ObjectMapSnapshotPayload } from '@core/refresh/types';

export type NormalizedObjectMapPayload = Omit<ObjectMapSnapshotPayload, 'nodes' | 'edges'> & {
  nodes: NonNullable<ObjectMapSnapshotPayload['nodes']>;
  edges: NonNullable<ObjectMapSnapshotPayload['edges']>;
};

export const normalizeObjectMapPayload = (
  payload: ObjectMapSnapshotPayload
): NormalizedObjectMapPayload => ({
  ...payload,
  nodes: payload.nodes ?? [],
  edges: payload.edges ?? [],
});
