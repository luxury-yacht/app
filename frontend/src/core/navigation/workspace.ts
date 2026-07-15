import type { ViewType } from '@/types/navigation/views';

export const shouldShowActiveClusterAuthFailure = (
  hasActiveClusters: boolean,
  viewType: ViewType
): boolean => hasActiveClusters && viewType !== 'global';

export const shouldSyncClusterNavigationTarget = (
  targetClusterId: string,
  selectedClusterId: string | undefined,
  workspace: 'cluster' | 'global'
): boolean => workspace === 'cluster' && targetClusterId === selectedClusterId;
