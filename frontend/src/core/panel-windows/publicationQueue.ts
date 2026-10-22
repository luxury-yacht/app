type QueuedOperation = {
  operation: () => Promise<void>;
  onError?: (error: unknown) => void;
  // What a command is about; settleCommands(key) retries and fails only those.
  key?: string;
};

type FailedOperation = QueuedOperation & { error: unknown };

// Keep failures separate from the tail: the next operation may recover the
// transport, but a close or transfer must not mistake a caught error for success.
// Arrangement reports supersede each other, so only the latest failed one is
// kept. Commands (close intents) never supersede: each failed command stays
// pending until a retry lands, so a later successful report cannot hide it.
export class PanelPublicationQueue {
  #tail: Promise<void> = Promise.resolve();
  // Settles once the latest queued command has run, so callers that need only
  // commands to land do not wait on reports queued after it.
  #lastCommand: Promise<void> = Promise.resolve();
  #failure: FailedOperation | null = null;
  #failedCommands: FailedOperation[] = [];

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

  command(operation: () => Promise<void>, onError?: (error: unknown) => void, key?: string): void {
    this.#enqueueCommand({ operation, onError, key }, true);
  }

  // Lands every queued command, then retries the failed ones (only those for
  // key, when given) once and rejects while one still fails. A retry that fails
  // again stays pending and is not reported twice; the caller sees the rejection.
  async settleCommands(key?: string): Promise<void> {
    await this.#landCommands();
    const matches = (command: QueuedOperation) => key === undefined || command.key === key;
    const failed = this.#failedCommands.filter(matches);
    this.#failedCommands = this.#failedCommands.filter((command) => !matches(command));
    for (const command of failed) {
      this.#enqueueCommand(command, false);
    }
    // Also waits for retries a concurrent settle queued.
    await this.#landCommands();
    const stillFailed = this.#failedCommands.find(matches);
    if (stillFailed) {
      throw stillFailed.error;
    }
  }

  async flush(): Promise<void> {
    await this.#drain();
    await this.settleCommands();
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

  #enqueueCommand(command: QueuedOperation, report: boolean): void {
    this.#tail = this.#tail.then(command.operation).then(undefined, (error: unknown) => {
      this.#failedCommands.push({ ...command, error });
      if (report) {
        command.onError?.(error);
      }
    });
    this.#lastCommand = this.#tail;
  }

  /** Test helper: forgets queued, failed, and pending operations. */
  resetForTesting(): void {
    this.#tail = Promise.resolve();
    this.#lastCommand = Promise.resolve();
    this.#failure = null;
    this.#failedCommands = [];
  }

  #landCommands(): Promise<void> {
    return untilSettled(() => this.#lastCommand);
  }

  #drain(): Promise<void> {
    return untilSettled(() => this.#tail);
  }
}

// Waits for the promise read() returns, and again if work queued meanwhile
// replaced it.
async function untilSettled(read: () => Promise<void>): Promise<void> {
  const pending = read();
  await pending;
  if (pending !== read()) {
    await untilSettled(read);
  }
}

// Each native webview has its own JS realm. The header's docking action and
// panel shortcuts share that renderer's publication queue.
export const nativePanelPublication = new PanelPublicationQueue();

export const workspacePanelPublication = new PanelPublicationQueue();

/** Test helper to clear both renderers' queues between runs. */
export const resetPanelPublicationQueuesForTesting = (): void => {
  nativePanelPublication.resetForTesting();
  workspacePanelPublication.resetForTesting();
};
