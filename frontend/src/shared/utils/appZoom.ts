export const getAppZoomFactor = (): number => {
  if (typeof document === 'undefined') {
    return 1;
  }
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--app-zoom-factor')
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};
