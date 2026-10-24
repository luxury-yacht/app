/**
 * frontend/src/utils/kindViewMap.ts
 *
 * Maps an object's API group, kind, and scope to the view that lists it, for
 * alt+click navigation (useNavigateToView). In order:
 * - its resource family's view (Karpenter, Argo CD, and so on);
 * - the view whose refresh domain is the kind's list domain (its kind facet);
 * - Browse, for a built-in kind that no view lists;
 * - the Custom view, for any other custom resource.
 */

import { resourceFamilyForObject } from '@core/navigation/resourceFamilies';
import {
  CLUSTER_VIEW_DESCRIPTORS,
  NAMESPACE_VIEW_DESCRIPTORS,
} from '@core/navigation/viewRegistry';
import { isBuiltinResource } from '@shared/constants/builtinGroupVersions';
import { lookupKindMetadata } from '@shared/kinds/kindFacets';
import type { ClusterViewType, NamespaceViewType, ViewType } from '@/types/navigation/views';

export interface ViewDestination {
  viewType: ViewType;
  tab: NamespaceViewType | ClusterViewType;
  destinationViewId?: string;
}

// Views that list a refresh domain. kindViewMap.test.ts checks at compile time
// that every kind's list domain has one.
const LIST_VIEWS = [...NAMESPACE_VIEW_DESCRIPTORS, ...CLUSTER_VIEW_DESCRIPTORS].filter(
  (view) => 'listDomain' in view
);

/** The view that lists a kind's list domain (its kind facet), if any view does. */
const listViewFor = (group: string, kind: string): ViewDestination | null => {
  const listDomain = lookupKindMetadata({ group, kind })?.listDomain ?? 'none';
  const view = LIST_VIEWS.find((candidate) => candidate.listDomain === listDomain);
  return view ? { viewType: view.scope, tab: view.id } : null;
};

/** The view that lists an object of `kind` in `group`; the kind matches in any case. */
export function getViewForKind(
  kind: string,
  group: string,
  namespace?: string | null
): ViewDestination {
  const namespaced = Boolean(namespace);
  const viewType = namespaced ? 'namespace' : 'cluster';
  const family = resourceFamilyForObject(group, kind, namespaced);
  if (family) {
    return { viewType, tab: family };
  }
  const listView = listViewFor(group, kind);
  if (listView) {
    return listView;
  }
  if (!isBuiltinResource(group, kind)) {
    return { viewType, tab: 'custom' };
  }
  // The cluster Browse table's view id is "browse" (BrowseView.tsx).
  return namespaced
    ? { viewType, tab: 'browse' }
    : { viewType, tab: 'browse', destinationViewId: 'browse' };
}
