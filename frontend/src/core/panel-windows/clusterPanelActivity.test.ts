import { expect, it, vi } from 'vitest';
import { ClusterPanelActivity } from './clusterPanelActivity';

it('drains admitted work, blocks closing-cluster work, and keeps sibling work available', async () => {
  const activity = new ClusterPanelActivity();
  let finish: () => void = () => undefined;
  const pending = activity.run(
    'production',
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  let paused = false;
  const pause = activity.pause('production').then(() => {
    paused = true;
  });
  const blocked = vi.fn(async () => 'unexpected');
  expect(await activity.run('production', blocked)).toBeNull();
  expect(blocked).not.toHaveBeenCalled();
  expect(await activity.run('staging', async () => 'available')).toBe('available');
  expect(paused).toBe(false);
  finish();
  await Promise.all([pause, pending]);
  expect(paused).toBe(true);
});

it('keeps accepted closes paused until selection commits and resumes denied closes', async () => {
  const activity = new ClusterPanelActivity();
  const changed = vi.fn();
  const cancel = activity.subscribe(changed);
  await activity.pause('production');
  activity.reconcile([]);
  expect(activity.isClosing('production')).toBe(true);
  activity.settle('production', true);
  activity.reconcile(['production']);
  expect(activity.isClosing('production')).toBe(true);
  activity.reconcile([]);
  expect(activity.isClosing('production')).toBe(false);
  await activity.pause('staging');
  activity.settle('staging', false);
  expect(activity.getSnapshot().size).toBe(0);
  expect(changed).toHaveBeenCalledTimes(5);
  cancel();
  await activity.pause('staging');
  expect(changed).toHaveBeenCalledTimes(5);
});

it('drains rejected operations without losing their failure', async () => {
  const activity = new ClusterPanelActivity();
  const failure = new Error('read failed');
  const operation = activity.run('production', () => {
    throw failure;
  });
  const rejection = expect(operation).rejects.toThrow(failure);
  await activity.pause('production');
  await rejection;
  activity.settle('production', false);
  expect(await activity.run('production', async () => 'recovered')).toBe('recovered');
});
