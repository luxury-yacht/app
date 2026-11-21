import type { panelwindow } from '@/core/backend-api/models';
import type { KubernetesObjectReference } from '@/types/view-state';
import { buildObjectPanelRef, type ObjectPanelRef, objectPanelId } from './objectPanelRef';

export interface IdentityPanelRef {
  targetType: 'identity';
  clusterId: string;
  kind: 'User' | 'Group';
  name: string;
}

/** A kind the cluster serves (not an object of that kind). `group` is empty for the core group. */
export interface ApiResourcePanelRef {
  targetType: 'api-resource';
  clusterId: string;
  group: string;
  version: string;
  kind: string;
  resource: string;
}

/** Panel targets that are not Kubernetes objects. */
export type NonObjectPanelRef = IdentityPanelRef | ApiResourcePanelRef;

export type PanelTarget = ObjectPanelRef | NonObjectPanelRef;

type PanelTargetInput = KubernetesObjectReference | NonObjectPanelRef;

export const isIdentityPanelRef = (ref: PanelTargetInput): ref is IdentityPanelRef =>
  ref.targetType === 'identity';

export const isApiResourcePanelRef = (ref: PanelTargetInput): ref is ApiResourcePanelRef =>
  ref.targetType === 'api-resource';

export const isNonObjectPanelRef = (ref: PanelTargetInput): ref is NonObjectPanelRef =>
  isIdentityPanelRef(ref) || isApiResourcePanelRef(ref);

/** The views a kind panel can show. */
export const API_RESOURCE_PANEL_VIEWS = ['details', 'explain'] as const;
export type ApiResourcePanelView = (typeof API_RESOURCE_PANEL_VIEWS)[number];

export const isApiResourcePanelView = (view: string): view is ApiResourcePanelView =>
  (API_RESOURCE_PANEL_VIEWS as readonly string[]).includes(view);

const buildApiResourcePanelRef = (input: ApiResourcePanelRef): ApiResourcePanelRef => {
  if (
    !input.clusterId?.trim() ||
    !input.version?.trim() ||
    !input.kind?.trim() ||
    !input.resource?.trim()
  ) {
    throw new Error('Incomplete kind panel reference');
  }
  return {
    targetType: 'api-resource',
    clusterId: input.clusterId,
    group: input.group ?? '',
    version: input.version,
    kind: input.kind,
    resource: input.resource,
  };
};

export function buildPanelTarget(input: PanelTargetInput): PanelTarget {
  if (isApiResourcePanelRef(input)) {
    return buildApiResourcePanelRef(input);
  }
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

// Every target type uses the shared panel sizing and layout preferences.
export const panelTargetId = (ref: PanelTarget): string => {
  if (isIdentityPanelRef(ref)) {
    return `obj:identity:${JSON.stringify([ref.clusterId, ref.kind, ref.name])}`;
  }
  if (isApiResourcePanelRef(ref)) {
    // Group and plural identify the kind; the version is how it is read.
    return `obj:api-resource:${JSON.stringify([ref.clusterId, ref.group, ref.resource])}`;
  }
  return objectPanelId(ref);
};

export function panelTargetFromSnapshot(tab: panelwindow.TabSnapshot): PanelTarget {
  if (
    tab.kind === 'identity' &&
    tab.identityRef &&
    !tab.objectRef &&
    !tab.apiResourceRef &&
    tab.activeView === 'details'
  ) {
    const ref = tab.identityRef;
    if (ref.kind !== 'User' && ref.kind !== 'Group') {
      throw new Error('Unsupported identity subject');
    }
    return buildPanelTarget({ targetType: 'identity', ...ref, kind: ref.kind });
  }
  if (
    tab.kind === 'api-resource' &&
    tab.apiResourceRef &&
    !tab.objectRef &&
    !tab.identityRef &&
    isApiResourcePanelView(tab.activeView)
  ) {
    return buildPanelTarget({ targetType: 'api-resource', ...tab.apiResourceRef });
  }
  if (tab.kind === 'object' && tab.objectRef && !tab.identityRef && !tab.apiResourceRef) {
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
  if (isApiResourcePanelRef(ref)) {
    return {
      kind: 'api-resource' as panelwindow.TabKind,
      panelId,
      // A view only object panels have falls back to the kind's details.
      activeView: isApiResourcePanelView(activeView) ? activeView : 'details',
      apiResourceRef: {
        clusterId: ref.clusterId,
        group: ref.group,
        version: ref.version,
        kind: ref.kind,
        resource: ref.resource,
      },
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
