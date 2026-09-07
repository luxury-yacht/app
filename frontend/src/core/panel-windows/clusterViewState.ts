import type { SidebarSelectionType } from '@/core/contexts/SidebarStateContext';
import type { NavigationTabState } from '@/core/contexts/ViewStateContext';
import { parseClusterViewType, parseNamespaceViewType, VIEW_TYPES } from '@/types/navigation/views';

export interface ClusterViewState {
  clusterId: string;
  navigation: NavigationTabState;
  namespace?: string;
  sidebar: SidebarSelectionType;
  tables: Record<string, unknown>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const localView = (value: unknown) =>
  typeof value === 'string' && value !== 'global' && VIEW_TYPES.some((view) => view === value);
function validNavigation(value: unknown): value is NavigationTabState {
  if (!record(value) || !localView(value.viewType) || !localView(value.previousView)) {
    return false;
  }
  if (
    typeof value.activeNamespaceView !== 'string' ||
    !parseNamespaceViewType(value.activeNamespaceView)
  ) {
    return false;
  }
  return (
    value.activeClusterView === null ||
    (typeof value.activeClusterView === 'string' && !!parseClusterViewType(value.activeClusterView))
  );
}
function validSidebar(value: unknown): value is SidebarSelectionType {
  if (value === null) {
    return true;
  }
  if (!record(value)) {
    return false;
  }
  if (value.type === 'namespace') {
    return typeof value.value === 'string';
  }
  return (value.type === 'overview' || value.type === 'cluster') && value.type === value.value;
}
export function decodeClusterViewState(serialized: string, clusterId: string): ClusterViewState {
  const value: unknown = JSON.parse(serialized);
  if (
    !record(value) ||
    value.clusterId !== clusterId ||
    !validNavigation(value.navigation) ||
    !validSidebar(value.sidebar) ||
    !record(value.tables)
  ) {
    throw new Error('Invalid cluster view state');
  }
  if (value.namespace !== undefined && typeof value.namespace !== 'string') {
    throw new Error('Invalid cluster namespace');
  }
  return {
    clusterId,
    navigation: value.navigation,
    sidebar: value.sidebar,
    namespace: value.namespace as string | undefined,
    tables: value.tables,
  };
}
