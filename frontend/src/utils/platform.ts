/**
 * frontend/src/utils/platform.ts
 *
 * Utility helpers for platform.
 * Provides shared helper functions for the frontend.
 */

export const isMacPlatform = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const platform = navigator.platform || '';
  const userAgent = navigator.userAgent || '';
  return /mac/i.test(platform) || /mac os x/i.test(userAgent);
};
