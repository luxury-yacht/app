import { isPermissionDeniedStatus } from '@/core/refresh/permissionErrors';

// Wails preserves many Go errors as messages. Match concrete outcomes, not UI
// category words such as "permission", "token", or "missing" on their own.
const expectedMessages = [
  /(?:^|:\s*)context cancel(?:ed|led)\s*$/i,
  /\b(?:permission denied|access denied|is forbidden)\b/i,
  /\b(?:401 unauthorized|403 forbidden)\b/i,
  /\b(?:http(?:\/\d(?:\.\d)?)?\s+|status(?:\s+(?:code|of))?(?:\s*[:=]\s*|\s+))(?:401|403)\b/i,
  /\b(?:unauthorized|authentication required)\b|\bauth invalid:/i,
  /\b(?:token|credentials?|sso session) (?:has |have |is |are )?expired\b/i,
  /\bgetting credentials: exec:/i,
  /\b[\w.-]+ "[^"]+" not found\b/i,
];

const isExpectedStatus = (error: object): boolean => {
  if (isPermissionDeniedStatus(error)) {
    return true;
  }
  if ('permissionDenied' in error && error.permissionDenied === true) {
    return true;
  }
  if (!('kind' in error) || error.kind !== 'Status' || !('code' in error) || !('reason' in error)) {
    return false;
  }
  return (
    (error.code === 401 && error.reason === 'Unauthorized') ||
    (error.code === 404 && error.reason === 'NotFound')
  );
};

const isExpectedValue = (error: unknown): boolean => {
  if (error instanceof Error && ['AbortError', 'CancelError'].includes(error.name)) {
    return true;
  }
  if (error instanceof DOMException && ['AbortError', 'NotAllowedError'].includes(error.name)) {
    return true;
  }
  if (typeof error === 'object' && error !== null && isExpectedStatus(error)) {
    return true;
  }
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return expectedMessages.some((pattern) => pattern.test(message));
};

// One decision for all handled-error surfaces, including wrapped Wails causes.
export const isExpectedOperationalError = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (isExpectedValue(current)) {
      return true;
    }
    current = current instanceof Error && 'cause' in current ? current.cause : undefined;
  }
  return false;
};
