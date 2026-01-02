/**
 * frontend/src/core/refresh/featureFlags.ts
 *
 * Feature flags for refresh behavior toggles.
 */

type ResourceStreamingMode = 'active' | 'shadow';

// Resource streaming is always enabled and active.
export const isResourceStreamingEnabled = (): boolean => true;

export const getResourceStreamingMode = (): ResourceStreamingMode => 'active';

export const getResourceStreamingDomainAllowlist = (): Set<string> | null => null;

export type { ResourceStreamingMode };
