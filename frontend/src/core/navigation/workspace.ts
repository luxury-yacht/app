import type { ViewType } from '@/types/navigation/views';

export const shouldShowActiveClusterAuthFailure = (
  hasActiveClusters: boolean,
  viewType: ViewType
): boolean => hasActiveClusters && viewType !== 'global';
