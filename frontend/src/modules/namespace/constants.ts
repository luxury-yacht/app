/**
 * frontend/src/modules/namespace/constants.ts
 *
 * Module source for constants.
 */
export const ALL_NAMESPACES_SCOPE = 'namespace:all';
export const ALL_NAMESPACES_DISPLAY_NAME = 'All Namespaces';
export const ALL_NAMESPACES_RESOURCE_VERSION = 'synthetic-all';
export const ALL_NAMESPACES_DETAILS = 'Includes objects from every namespace (experimental)';

export const isAllNamespaces = (value?: string | null): boolean => value === ALL_NAMESPACES_SCOPE;
