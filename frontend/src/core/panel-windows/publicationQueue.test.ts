import { describe, expect, it, vi } from 'vitest';
import { PanelPublicationQueue } from './publicationQueue';

describe('PanelPublicationQueue', () => {
  it('waits for ordered publication before allowing a transfer', async () => {
    const queue = new PanelPublicationQueue();
    let finish!: () => void;
    const publish = vi.fn();
    queue.publish(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    queue.publish(async () => {
      publish();
    });
    const ready = vi.fn();
    const flush = queue.flush().then(ready);
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
    finish();
    await flush;
    expect(publish).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
  });

  it('blocks disposal after failed publication and recovers on successful retry', async () => {
    const queue = new PanelPublicationQueue();
    const error = new Error('transport unavailable');
    queue.publish(async () => {
      throw error;
    });
    await expect(queue.flush()).rejects.toBe(error);
    await expect(queue.flush()).rejects.toBe(error);
    queue.publish(async () => undefined);
    await expect(queue.flush()).resolves.toBeUndefined();
  });
  it('retries the failed snapshot on flush without a layout change', async () => {
    const queue = new PanelPublicationQueue();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const report = vi.fn();
    queue.publish(operation, report);
    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce());
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed command until a retry lands, even after newer publications succeed', async () => {
    const queue = new PanelPublicationQueue();
    const close = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValue(undefined);
    const report = vi.fn();
    queue.command(close, report);
    queue.publish(async () => undefined);
    await expect(queue.flush()).rejects.toThrow('still offline');
    await expect(queue.flush()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenCalledOnce();
  });

  it('lets concurrent settles both wait for the retry of a failed command', async () => {
    const queue = new PanelPublicationQueue();
    let finishRetry!: () => void;
    const close = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRetry = resolve;
          })
      );
    queue.command(close);
    const settled = vi.fn();
    const first = queue.settleCommands().then(settled);
    const second = queue.settleCommands().then(settled);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(2));
    expect(settled).not.toHaveBeenCalled();
    finishRetry();
    await Promise.all([first, second]);
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it("settles one panel's commands without waiting on another panel's failure", async () => {
    const queue = new PanelPublicationQueue();
    const closeApi = vi
      .fn()
      .mockRejectedValueOnce(new Error('api offline'))
      .mockResolvedValue(undefined);
    const closeWorker = vi.fn().mockRejectedValue(new Error('worker offline'));
    queue.command(closeApi, undefined, 'api');
    queue.command(closeWorker, undefined, 'worker');

    await expect(queue.settleCommands('api')).resolves.toBeUndefined();
    expect(closeApi).toHaveBeenCalledTimes(2);
    expect(closeWorker).toHaveBeenCalledOnce();
    await expect(queue.settleCommands('worker')).rejects.toThrow('worker offline');
    await expect(queue.flush()).rejects.toThrow('worker offline');
  });

  it('never retries an obsolete failed snapshot after a newer successful publication', async () => {
    const queue = new PanelPublicationQueue();
    const obsolete = vi.fn().mockRejectedValue(new Error('offline'));
    queue.publish(obsolete);
    queue.publish(async () => undefined);
    await queue.flush();
    expect(obsolete).toHaveBeenCalledOnce();
  });
});
