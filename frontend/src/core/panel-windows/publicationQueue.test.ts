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

  it('never retries an obsolete failed snapshot after a newer successful publication', async () => {
    const queue = new PanelPublicationQueue();
    const obsolete = vi.fn().mockRejectedValue(new Error('offline'));
    queue.publish(obsolete);
    queue.publish(async () => undefined);
    await queue.flush();
    expect(obsolete).toHaveBeenCalledOnce();
  });
});
