/**
 * frontend/src/core/refresh/featureFlags.ts
 *
 * Feature flags for refresh behavior toggles.
 */

export const isResourceStreamingEnabled = (): boolean =>
  (import.meta as any)?.env?.VITE_RESOURCE_STREAMING === 'true';
