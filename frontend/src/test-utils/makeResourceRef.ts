import type { ResourceRef } from '@/core/refresh/types';

export const makeResourceRef = (
  ref: Pick<ResourceRef, 'kind' | 'resource' | 'name'> & Partial<ResourceRef>
): ResourceRef => ({
  clusterId: 'alpha:ctx',
  group: '',
  version: 'v1',
  namespace: '',
  uid: '',
  ...ref,
});
