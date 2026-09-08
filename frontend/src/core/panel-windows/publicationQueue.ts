// Keep the failure separate from the tail: the next snapshot may recover the
// transport, but a close or transfer must not mistake a caught error for success.
export class PanelPublicationQueue {
  #tail: Promise<void> = Promise.resolve();
  #failure: {
    error: unknown;
    operation: () => Promise<void>;
    onError?: (error: unknown) => void;
  } | null = null;

  publish(operation: () => Promise<void>, onError?: (error: unknown) => void): void {
    this.#tail = this.#tail.then(operation).then(
      () => {
        this.#failure = null;
      },
      (error: unknown) => {
        this.#failure = { error, operation, onError };
        onError?.(error);
      }
    );
  }

  async flush(): Promise<void> {
    await this.#drain();
    if (this.#failure) {
      // Retry once at the close/transfer boundary, even if the layout has not
      // changed. A newer publication supersedes the failed snapshot.
      const { operation, onError } = this.#failure;
      this.publish(operation, onError);
      await this.#drain();
    }
    if (this.#failure) {
      throw this.#failure.error;
    }
  }

  async #drain(): Promise<void> {
    let pending: Promise<void>;
    do {
      pending = this.#tail;
      await pending;
    } while (pending !== this.#tail);
  }
}

// Each native webview has its own JS realm. The header's docking action and
// panel shortcuts share that renderer's publication queue.
export const nativePanelPublication = new PanelPublicationQueue();

export const workspacePanelPublication = new PanelPublicationQueue();
