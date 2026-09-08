import './panelLifecycleGuards.css';
import type React from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { errorHandler } from '@/utils/errorHandler';

export type PanelBlockReason = 'unsaved-yaml' | 'mutation-in-flight' | 'transfer-in-flight';

export interface PanelLifecycleBlocker {
  panelId?: string;
  reason: PanelBlockReason;
  focus: () => void;
}

type PanelGuard = () => PanelLifecycleBlocker | null;

export class PanelLifecycleGuardRegistry {
  readonly #transfers = new Map<string, { panelIds: readonly string[]; status: string }>();
  readonly #listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  isFrozen = (exceptTransactionId?: string) =>
    Array.from(this.#transfers.keys()).some((id) => id !== exceptTransactionId);
  frozenStatus = () => this.#transfers.values().next().value?.status ?? '';
  freeze(transferId: string, panelIds: readonly string[], status = 'Moving panels…'): void {
    this.#transfers.set(transferId, { panelIds: [...panelIds], status });
    for (const listener of this.#listeners) {
      listener();
    }
  }
  releaseTransfer(transferId: string): void {
    if (!this.#transfers.delete(transferId)) {
      return;
    }
    for (const listener of this.#listeners) {
      listener();
    }
  }
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
      if (Array.from(this.#transfers.values()).some((entry) => entry.panelIds.includes(panelId))) {
        return {
          panelId,
          reason: 'transfer-in-flight',
          focus: () =>
            errorHandler.warn('Wait for the panel move to finish.', { title: 'Moving panels' }),
        };
      }
      for (const guard of this.#guards.get(panelId) ?? []) {
        const blocker = guard();
        if (blocker) {
          return {
            ...blocker,
            panelId,
            focus: () => {
              blocker.focus();
              const unsaved = blocker.reason === 'unsaved-yaml';
              errorHandler.warn(
                unsaved
                  ? 'Save or discard your YAML changes before closing or moving this panel.'
                  : 'Wait for the current operation to finish before closing or moving this panel.',
                { title: unsaved ? 'Unsaved YAML changes' : 'Operation in progress' }
              );
            },
          };
        }
      }
    }
    return null;
  }
}

// Keep the renderer inert from the guard decision through publication. The
// caller releases the transaction only after disposal commits or is cancelled.
export async function preparePanelClose({
  guards,
  transactionId,
  panelIds,
  status,
  flush,
  focusBlocker,
}: {
  guards: PanelLifecycleGuardRegistry;
  transactionId: string;
  panelIds: readonly string[];
  status: string;
  flush: () => Promise<void>;
  focusBlocker: (blocker: PanelLifecycleBlocker) => void;
}): Promise<boolean> {
  if (guards.isFrozen()) {
    return false;
  }
  const blocker = guards.firstBlocker(panelIds);
  if (blocker) {
    focusBlocker(blocker);
    return false;
  }
  guards.freeze(transactionId, panelIds, status);
  try {
    await flush();
    return true;
  } catch (error) {
    guards.releaseTransfer(transactionId);
    throw error;
  }
}

const PanelLifecycleGuardContext = createContext<PanelLifecycleGuardRegistry | null>(null);

export const PanelLifecycleGuardProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const registry = useMemo(() => new PanelLifecycleGuardRegistry(), []);
  const surface = useRef<HTMLDivElement>(null);
  const status = useSyncExternalStore(registry.subscribe, registry.frozenStatus, () => '');
  const frozen = Boolean(status);
  useLayoutEffect(() => {
    const update = () => {
      if (surface.current) {
        surface.current.inert = registry.isFrozen();
      }
    };
    const cancel = registry.subscribe(update);
    const blockInput = (event: Event) => {
      if (!registry.isFrozen()) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const events = ['keydown', 'beforeinput', 'pointerdown', 'click', 'contextmenu'];
    for (const name of events) {
      window.addEventListener(name, blockInput, true);
    }
    return () => {
      cancel();
      for (const name of events) {
        window.removeEventListener(name, blockInput, true);
      }
    };
  }, [registry]);
  return (
    <PanelLifecycleGuardContext.Provider value={registry}>
      <div ref={surface} className="panel-lifecycle-surface" inert={frozen}>
        {children}
      </div>
      {frozen && <output className="panel-transfer-status">{status}</output>}
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
