export const BROWSE_PAGE_LIMIT_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;
export const DEFAULT_BROWSE_PAGE_LIMIT = 50;
export type BrowsePageLimit = (typeof BROWSE_PAGE_LIMIT_OPTIONS)[number];
