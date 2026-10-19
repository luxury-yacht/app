import { parseRefreshScope } from './scopeSelector';
import type { RefreshDomain } from './types';

/**
 * Checks a scope against the domain's scope grammar before it enters refresh
 * state and returns it trimmed. Producers build scopes only through the scope
 * codec, so a scope that does not decode is a caller bug: it throws instead of
 * being repaired against the current selection.
 */
export const normalizeRefreshDomainScope = (
  domain: RefreshDomain,
  value?: string | null
): string | undefined => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return undefined;
  }
  parseRefreshScope(domain, trimmed);
  return trimmed;
};
