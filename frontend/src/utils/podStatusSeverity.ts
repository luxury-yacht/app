/**
 * frontend/src/utils/podStatusSeverity.ts
 *
 * Utility helpers for podStatusSeverity.
 * Provides shared helper functions for the frontend.
 */

export function getPodStatusSeverity(status: string): 'error' | 'warning' | 'info' {
  if (!status) return 'info';

  const normalizedStatus = status.toLowerCase();

  // Error states
  const errorStatuses = [
    'failed',
    'unknown',
    'error',
    'crashloopbackoff',
    'errImagePull',
    'imagepullbackoff',
    'createcontainerconfigerror',
    'createcontainererror',
    'errimagepull',
    'evicted',
    'invalidimagen',
    'poststarThookerror',
    'prestarthookerror',
    'runcontainererror',
  ];

  // Warning states
  const warningStatuses = ['pending', 'terminating', 'containercreating', 'podinitializing'];

  // Check for error states
  if (errorStatuses.some((s) => normalizedStatus.includes(s.toLowerCase()))) {
    return 'error';
  }

  // Check for warning states
  if (warningStatuses.some((s) => normalizedStatus.includes(s.toLowerCase()))) {
    return 'warning';
  }

  // Check for Init-prefixed statuses
  if (normalizedStatus.startsWith('init:')) {
    if (normalizedStatus.includes('/')) {
      return 'warning'; // Init progress like Init:0/1
    }
    const initErrors = ['crashloopbackoff', 'errimagepull', 'error', 'imagepullbackoff'];
    if (initErrors.some((e) => normalizedStatus.includes(e))) {
      return 'error';
    }
    return 'warning'; // Other Init: states
  }

  // Default to info for running/succeeded/completed
  return 'info';
}
