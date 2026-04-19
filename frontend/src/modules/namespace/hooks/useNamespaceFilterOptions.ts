import { useContext, useMemo } from 'react';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { NamespaceContext } from '@modules/namespace/contexts/NamespaceContext';

const normalizeNamespaces = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.map((value) => value?.trim() ?? '').filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );

/**
 * Prefer explicit namespace metadata for All Namespaces filters instead of
 * rescanning the currently loaded row payload.
 */
export const useNamespaceFilterOptions = (
  namespaceScope: string,
  fallbackNamespaces: string[]
): string[] => {
  const namespaceContext = useContext(NamespaceContext);
  const namespaceItems = namespaceContext?.namespaces;

  return useMemo(() => {
    const namespaces = namespaceItems ?? [];
    const fallback = normalizeNamespaces(fallbackNamespaces);
    if (namespaceScope !== ALL_NAMESPACES_SCOPE) {
      return fallback;
    }

    const explicit = normalizeNamespaces(
      namespaces
        .filter((namespace) => !namespace.isSynthetic)
        .map((namespace) => namespace.scope ?? namespace.name)
    );

    return explicit.length > 0 ? explicit : fallback;
  }, [fallbackNamespaces, namespaceItems, namespaceScope]);
};
