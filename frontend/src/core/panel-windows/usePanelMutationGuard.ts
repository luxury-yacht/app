import { useCallback, useReducer, useRef } from 'react';
import { usePanelLifecycleGuard } from './panelLifecycleGuards';

/** Keep disposal blocked from admission through settlement, including between React renders. */
export function usePanelMutationGuard(panelId: string | null, externalLoading = false) {
  const count = useRef(0);
  const [, advanceRevision] = useReducer((revision: number) => revision + 1, 0);
  const onMutationChange = useCallback((inFlight: boolean) => {
    count.current = Math.max(0, count.current + (inFlight ? 1 : -1));
    advanceRevision();
  }, []);
  const executeMutation = useCallback(
    async <T>(execute: () => Promise<T>): Promise<T> => {
      onMutationChange(true);
      try {
        return await execute();
      } finally {
        onMutationChange(false);
      }
    },
    [onMutationChange]
  );

  usePanelLifecycleGuard(panelId, () => {
    if (!externalLoading && count.current === 0) {
      return null;
    }
    return {
      reason: 'mutation-in-flight',
      focus: () => {
        if (!panelId || typeof document === 'undefined') {
          return;
        }
        Array.from(document.querySelectorAll<HTMLElement>('[data-panel-id]'))
          .find((element) => element.dataset.panelId === panelId)
          ?.focus();
      },
    };
  });
  return { executeMutation, onMutationChange };
}
