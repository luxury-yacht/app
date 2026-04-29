const DEFAULT_SCROLLBAR_ACTIVE_TIMEOUT_MS = 900;
const DEFAULT_SCROLLBAR_FADE_IN_DURATION_MS = 100;
const DEFAULT_SCROLLBAR_FADE_OUT_DURATION_MS = 1000;

const parseScrollbarDurationMs = (
  value: string,
  fallback = DEFAULT_SCROLLBAR_ACTIVE_TIMEOUT_MS
): number => {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  if (trimmed.endsWith('ms')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (trimmed.endsWith('s')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(parsed) ? parsed * 1000 : fallback;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readScrollbarTokenStyles = (element?: Element | null): CSSStyleDeclaration =>
  getComputedStyle(element ?? document.documentElement);

export const readScrollbarActiveTimeoutMs = (element?: Element | null): number =>
  parseScrollbarDurationMs(
    readScrollbarTokenStyles(element).getPropertyValue('--scrollbar-active-timeout'),
    DEFAULT_SCROLLBAR_ACTIVE_TIMEOUT_MS
  );

export const readScrollbarFadeDurationMs = (
  direction: 'in' | 'out',
  element?: Element | null
): number => {
  const styles = readScrollbarTokenStyles(element);
  const directionalToken =
    direction === 'in' ? '--scrollbar-fade-in-duration' : '--scrollbar-fade-out-duration';
  const fallback =
    direction === 'in'
      ? DEFAULT_SCROLLBAR_FADE_IN_DURATION_MS
      : DEFAULT_SCROLLBAR_FADE_OUT_DURATION_MS;
  return parseScrollbarDurationMs(styles.getPropertyValue(directionalToken), fallback);
};

export const readScrollbarOpacityToken = (
  tokenName: string,
  fallback: number,
  element?: Element | null
): number => {
  const parsed = Number.parseFloat(readScrollbarTokenStyles(element).getPropertyValue(tokenName));
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const readScrollbarPxToken = (
  tokenName: string,
  fallback: number,
  element?: Element | null
): number => {
  const value = readScrollbarTokenStyles(element).getPropertyValue(tokenName).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const readScrollbarNumberToken = (
  tokenName: string,
  fallback: number,
  element?: Element | null
): number => {
  const parsed = Number.parseFloat(readScrollbarTokenStyles(element).getPropertyValue(tokenName));
  return Number.isFinite(parsed) ? parsed : fallback;
};
