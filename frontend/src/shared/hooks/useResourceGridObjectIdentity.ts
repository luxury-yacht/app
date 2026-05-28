import { useCallback } from 'react';
import type { KubernetesObjectReference } from '@/types/view-state';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';
import type { OpenWithObjectOptions } from '@modules/object-panel/hooks/useObjectPanel';

export interface ResourceGridObjectIdentityInput {
  kind?: string | null;
  kindAlias?: string | null;
  name?: string | null;
  namespace?: string | null;
  clusterId?: string | null;
  clusterName?: string | null;
  group?: string | null;
  version?: string | null;
}

export interface ResourceGridObjectIdentityAdapter<T> {
  key: (row: T, index?: number) => string;
  ref: (row: T) => ResolvedObjectReference;
  open: (row: T) => void;
  openMap: (row: T) => void;
  navigate: (row: T) => void;
  rowIdentity: (row: T, index: number) => string;
}

interface UseResourceGridObjectIdentityParams<T> {
  fallbackClusterId?: string | null;
  getObject: (row: T) => ResourceGridObjectIdentityInput;
  openWithObject: (object: KubernetesObjectReference, options?: OpenWithObjectOptions) => void;
  navigateToView: (object: KubernetesObjectReference) => void;
}

export function useResourceGridObjectIdentity<T>({
  fallbackClusterId,
  getObject,
  openWithObject,
  navigateToView,
}: UseResourceGridObjectIdentityParams<T>): ResourceGridObjectIdentityAdapter<T> {
  const ref = useCallback(
    (row: T) => buildRequiredObjectReference(getObject(row), { fallbackClusterId }),
    [fallbackClusterId, getObject]
  );

  const key = useCallback(
    (row: T) => buildRequiredCanonicalObjectRowKey(getObject(row), { fallbackClusterId }),
    [fallbackClusterId, getObject]
  );

  const open = useCallback((row: T) => openWithObject(ref(row)), [openWithObject, ref]);
  const openMap = useCallback(
    (row: T) => openWithObject(ref(row), { initialTab: 'map' }),
    [openWithObject, ref]
  );
  const navigate = useCallback((row: T) => navigateToView(ref(row)), [navigateToView, ref]);
  const rowIdentity = useCallback((row: T, _index: number) => key(row), [key]);

  return {
    key,
    ref,
    open,
    openMap,
    navigate,
    rowIdentity,
  };
}
