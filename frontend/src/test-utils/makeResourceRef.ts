import type { CanonicalResourceRef, ResourceRef } from '@/core/refresh/types';

export const makeResourceRef = (
  ref: { kind: string; resource: string; name: string } & Partial<ResourceRef>
): CanonicalResourceRef => ({
  clusterId: 'alpha:ctx',
  group: '',
  version: 'v1',
  namespace: '',
  uid: '',
  ...ref,
});
