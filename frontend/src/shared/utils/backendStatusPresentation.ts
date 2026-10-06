import type { StatusChipVariant } from '@shared/components/StatusChip';

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

const STATUS_CHIP_VARIANTS: Record<string, StatusChipVariant> = {
  ready: 'healthy',
  error: 'unhealthy',
  warning: 'warning',
};

/** Chip variant for a backend presentation token; progressing, unknown, and missing tokens are informational. */
export const backendStatusChipVariant = (statusPresentation?: string | null): StatusChipVariant =>
  STATUS_CHIP_VARIANTS[backendStatusClass(statusPresentation)] ?? 'info';
