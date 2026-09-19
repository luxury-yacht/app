import { errorHandler } from '@utils/errorHandler';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import type { BackendErrorPayload } from '@/types/backend-events';
import { useBackendErrorHandler } from './useBackendErrorHandler';

const events = vi.hoisted(() => ({
  listener: undefined as ((payload: BackendErrorPayload) => void) | undefined,
  unsubscribe: vi.fn(),
}));
vi.mock('@/core/desktop-runtime', () => ({
  onEvent: vi.fn((_name, listener) => {
    events.listener = listener;
    return events.unsubscribe;
  }),
}));
vi.mock('@utils/errorHandler', () => ({ errorHandler: { handle: vi.fn() } }));

let root: Root;
function Probe() {
  useBackendErrorHandler();
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it('reports the same resource failure independently for each cluster and deduplicates repeats', () => {
  const failure = { resourceKind: 'Pod', identifier: 'default/web', message: 'read failed' };
  requireValue(events.listener, 'backend error subscription')({ ...failure, clusterId: 'a' });
  requireValue(events.listener, 'backend error subscription')({ ...failure, clusterId: 'b' });
  requireValue(events.listener, 'backend error subscription')({ ...failure, clusterId: 'a' });
  expect(errorHandler.handle).toHaveBeenCalledTimes(2);
  for (const clusterId of ['a', 'b']) {
    expect(errorHandler.handle).toHaveBeenCalledWith(
      new Error('read failed'),
      expect.objectContaining({ clusterId, resourceKind: 'Pod', identifier: 'default/web' })
    );
  }
});

it('retains global stderr errors and suppresses errors already owned by the auth overlay', () => {
  requireValue(
    events.listener,
    'backend error subscription'
  )({ clusterId: '', source: 'stderr', message: 'helper failed' });
  requireValue(
    events.listener,
    'backend error subscription'
  )({ clusterId: '', source: 'stderr', message: 'helper failed' });
  requireValue(
    events.listener,
    'backend error subscription'
  )({ clusterId: 'a', message: 'Error loading SSO Token: expired' });
  requireValue(
    events.listener,
    'backend error subscription'
  )({ clusterId: 'a', message: 'no active clusters available' });
  expect(errorHandler.handle).toHaveBeenCalledOnce();
  expect(errorHandler.handle).toHaveBeenCalledWith(
    new Error('helper failed'),
    expect.objectContaining({ clusterId: '' })
  );
});
