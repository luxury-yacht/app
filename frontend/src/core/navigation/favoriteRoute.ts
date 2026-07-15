import { parseGlobalViewType } from '@/types/navigation/views';

export type FavoriteRouteScope = 'global' | 'cluster' | 'namespace';

export interface FavoriteRoute {
  scope: FavoriteRouteScope;
  view: string;
}

/**
 * Normalize persisted favorite routes at the navigation boundary. Global
 * favorites were historically stored as cluster routes, so both encodings
 * resolve to the first-class Global workspace.
 */
export const resolveFavoriteRoute = (viewType: string, view: string): FavoriteRoute => {
  if (viewType === 'global' || (viewType === 'cluster' && parseGlobalViewType(view))) {
    return { scope: 'global', view };
  }
  return {
    scope: viewType === 'namespace' ? 'namespace' : 'cluster',
    view,
  };
};
