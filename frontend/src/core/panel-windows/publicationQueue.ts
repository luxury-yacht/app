// Keep the failure separate from the tail: the next snapshot may recover the
// transport, but a close or transfer must not mistake a caught error for success.
export class PanelPublicationQueue {
  #tail: Promise<void> = Promise.resolve();
  #failure: unknown = null;

  publish(operation: () => Promise<void>, onError?: (error: unknown) => void): void {
    this.#tail = this.#tail.then(operation).then(
      () => {
        this.#failure = null;
      },
      (error: unknown) => {
        this.#failure = error;
        onError?.(error);
      }
    );
  }

  async flush(): Promise<void> {
    let pending: Promise<void>;
    do {
      pending = this.#tail;
      await pending;
    } while (pending !== this.#tail);
    if (this.#failure) {
      throw this.#failure;
    }
  }
}

// Each native webview has its own JS realm. The header's docking action and
// panel shortcuts share that renderer's publication queue.
export const nativePanelPublication = new PanelPublicationQueue();

export const workspacePanelPublication = new PanelPublicationQueue();
