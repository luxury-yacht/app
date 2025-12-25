/**
 * frontend/src/shared/components/tables/hooks/useGridTableFilterHandlers.ts
 *
 * React hook for useGridTableFilterHandlers.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback } from 'react';

interface UseGridTableFilterHandlersOptions {
  handleFilterKindsChange: (next: string[]) => void;
  handleFilterNamespacesChange: (next: string[]) => void;
}

export function useGridTableFilterHandlers({
  handleFilterKindsChange,
  handleFilterNamespacesChange,
}: UseGridTableFilterHandlersOptions) {
  const handleKindDropdownChange = useCallback(
    (value: string | string[]) => {
      const next = Array.isArray(value) ? value : value ? [value] : [];
      handleFilterKindsChange(next);
    },
    [handleFilterKindsChange]
  );

  const handleNamespaceDropdownChange = useCallback(
    (value: string | string[]) => {
      const next = Array.isArray(value) ? value : value ? [value] : [];
      handleFilterNamespacesChange(next);
    },
    [handleFilterNamespacesChange]
  );

  return { handleKindDropdownChange, handleNamespaceDropdownChange };
}
