import type React from 'react';
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';

export type PanelBlockReason = 'unsaved-yaml' | 'mutation-in-flight';

export interface PanelLifecycleBlocker {
  panelId?: string;
  reason: PanelBlockReason;
  focus: () => void;
}

type PanelGuard = () => PanelLifecycleBlocker | null;

export class PanelLifecycleGuardRegistry {
  readonly #guards = new Map<string, Set<PanelGuard>>();

  register(panelId: string, guard: PanelGuard): () => void {
    const guards = this.#guards.get(panelId) ?? new Set<PanelGuard>();
    guards.add(guard);
    this.#guards.set(panelId, guards);
    return () => {
      guards.delete(guard);
      if (guards.size === 0) {
        this.#guards.delete(panelId);
      }
    };
  }

  firstBlocker(panelIds: readonly string[]): PanelLifecycleBlocker | null {
    for (const panelId of panelIds) {
      for (const guard of this.#guards.get(panelId) ?? []) {
        const blocker = guard();
        if (blocker) {
          return { ...blocker, panelId };
        }
      }
    }
    return null;
  }
}

const PanelLifecycleGuardContext = createContext<PanelLifecycleGuardRegistry | null>(null);

export const PanelLifecycleGuardProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const registry = useMemo(() => new PanelLifecycleGuardRegistry(), []);
  return (
    <PanelLifecycleGuardContext.Provider value={registry}>
      {children}
    </PanelLifecycleGuardContext.Provider>
  );
};

export const usePanelLifecycleGuardRegistry = (): PanelLifecycleGuardRegistry => {
  const registry = useContext(PanelLifecycleGuardContext);
  if (!registry) {
    throw new Error('Panel lifecycle guards require PanelLifecycleGuardProvider');
  }
  return registry;
};

export const useOptionalPanelLifecycleGuardRegistry = (): PanelLifecycleGuardRegistry | null =>
  useContext(PanelLifecycleGuardContext);

export const usePanelLifecycleGuard = (panelId: string | null, guard: PanelGuard): void => {
  const registry = useContext(PanelLifecycleGuardContext);
  const guardRef = useRef(guard);
  guardRef.current = guard;
  useEffect(() => {
    if (!registry || !panelId) {
      return;
    }
    return registry.register(panelId, () => guardRef.current());
  }, [panelId, registry]);
};
