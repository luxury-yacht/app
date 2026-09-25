import type { panelwindow } from '@/core/backend-api/models';
import type { KubernetesObjectReference } from '@/types/view-state';
import { buildObjectPanelRef, type ObjectPanelRef, objectPanelId } from './objectPanelRef';

export interface IdentityPanelRef {
  targetType: 'identity';
  clusterId: string;
  kind: 'User' | 'Group';
  name: string;
}

export type PanelTarget = ObjectPanelRef | IdentityPanelRef;

export const isIdentityPanelRef = (
  ref: KubernetesObjectReference | IdentityPanelRef
): ref is IdentityPanelRef => ref.targetType === 'identity';

export function buildPanelTarget(input: KubernetesObjectReference | IdentityPanelRef): PanelTarget {
  if (!isIdentityPanelRef(input)) {
    return buildObjectPanelRef(input);
  }
  if (
    !input.clusterId?.trim() ||
    !input.name ||
    (input.kind !== 'User' && input.kind !== 'Group')
  ) {
    throw new Error('Incomplete identity panel reference');
  }
  return { targetType: 'identity', clusterId: input.clusterId, kind: input.kind, name: input.name };
}

// Both target types use the shared panel sizing and layout preferences.
export const panelTargetId = (ref: PanelTarget): string =>
  isIdentityPanelRef(ref)
    ? `obj:identity:${JSON.stringify([ref.clusterId, ref.kind, ref.name])}`
    : objectPanelId(ref);

export function panelTargetFromSnapshot(tab: panelwindow.TabSnapshot): PanelTarget {
  if (
    tab.kind === 'identity' &&
    tab.identityRef &&
    !tab.objectRef &&
    tab.activeView === 'details'
  ) {
    const ref = tab.identityRef;
    if (ref.kind !== 'User' && ref.kind !== 'Group') {
      throw new Error('Unsupported identity subject');
    }
    return buildPanelTarget({ targetType: 'identity', ...ref, kind: ref.kind });
  }
  if (tab.kind === 'object' && tab.objectRef && !tab.identityRef) {
    return buildObjectPanelRef({ ...tab.objectRef });
  }
  throw new Error('Invalid panel target');
}

export function panelTargetSnapshot(
  panelId: string,
  ref: PanelTarget,
  activeView: string
): panelwindow.TabSnapshot {
  if (isIdentityPanelRef(ref)) {
    return {
      kind: 'identity' as panelwindow.TabKind,
      panelId,
      activeView: 'details',
      identityRef: { clusterId: ref.clusterId, kind: ref.kind, name: ref.name },
    };
  }
  return {
    kind: 'object' as panelwindow.TabKind,
    panelId,
    activeView,
    objectRef: {
      clusterId: ref.clusterId,
      group: ref.group,
      version: ref.version,
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    },
  };
}
