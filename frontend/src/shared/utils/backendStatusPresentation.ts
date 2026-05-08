const STATUS_PRESENTATION_CLASS = /^[a-z][a-z0-9_-]*$/i;

export const backendStatusClass = (statusPresentation?: string | null): string => {
  const value = (statusPresentation ?? '').trim();
  if (!value || !STATUS_PRESENTATION_CLASS.test(value)) {
    return 'unknown';
  }
  return value.toLowerCase();
};

export const backendStatusTextClass = (statusPresentation?: string | null): string =>
  `status-text ${backendStatusClass(statusPresentation)}`;
