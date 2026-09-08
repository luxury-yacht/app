// A cluster view must finish its directory work before the backend removes it.
export class ClusterPanelActivity {
  readonly #pending = new Map<string, Set<Promise<unknown>>>();
  #closing = new Map<string, boolean>();
  readonly #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = (): ReadonlyMap<string, boolean> => this.#closing;
  #publish(): void {
    this.#closing = new Map(this.#closing);
    for (const listener of this.#listeners) {
      listener();
    }
  }

  isClosing = (clusterId: string) => this.#closing.has(clusterId);

  async run<T>(clusterId: string, operation: () => Promise<T>): Promise<T | null> {
    if (this.isClosing(clusterId)) {
      return null;
    }
    const pending = this.#pending.get(clusterId) ?? new Set<Promise<unknown>>();
    this.#pending.set(clusterId, pending);
    const task = Promise.resolve().then(operation);
    pending.add(task);
    try {
      return await task;
    } finally {
      pending.delete(task);
      if (!pending.size) {
        this.#pending.delete(clusterId);
      }
    }
  }

  async pause(clusterId: string): Promise<void> {
    this.#closing.set(clusterId, false);
    this.#publish();
    await Promise.allSettled(this.#pending.get(clusterId) ?? []);
  }

  settle(clusterId: string, closed: boolean): void {
    if (closed) {
      this.#closing.set(clusterId, true);
    } else {
      this.#closing.delete(clusterId);
    }
    this.#publish();
  }

  reconcile(clusterIds: readonly string[]): void {
    let changed = false;
    for (const [clusterId, closed] of this.#closing) {
      if (closed && !clusterIds.includes(clusterId)) {
        this.#closing.delete(clusterId);
        changed = true;
      }
    }
    if (changed) {
      this.#publish();
    }
  }
}
