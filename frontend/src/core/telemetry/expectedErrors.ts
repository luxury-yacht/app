import { errorStatusOf } from '@utils/errorStatus';

// Browser conditions that are outcomes, not failures: a superseded or
// cancelled request, and a permission prompt the user declined.
const isExpectedBrowserCondition = (error: unknown): boolean =>
  (error instanceof Error && ['AbortError', 'CancelError'].includes(error.name)) ||
  (error instanceof DOMException && ['AbortError', 'NotAllowedError'].includes(error.name));

/**
 * One reporting decision for every handled error: the backend status's own
 * `expected` verdict when there is a status, otherwise only the browser
 * conditions above. Message text never decides.
 */
export const isExpectedOperationalError = (error: unknown): boolean => {
  const status = errorStatusOf(error);
  if (status) {
    return status.expected;
  }
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (isExpectedBrowserCondition(current)) {
      return true;
    }
    current = current instanceof Error && 'cause' in current ? current.cause : undefined;
  }
  return false;
};
