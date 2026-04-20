/**
 * frontend/src/shared/components/tables/hooks/useFrameSampler.test.tsx
 *
 * Test suite for useFrameSampler.
 * Covers key behaviors and edge cases for useFrameSampler.
 */

import React, { act, useImperativeHandle } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useFrameSampler,
  type FrameSamplerSample,
} from '@shared/components/tables/hooks/useFrameSampler';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessHandle = {
  start: () => void;
  stop: (reason?: 'timeout' | 'manual' | 'unmount') => void;
};

interface HarnessProps {
  enabled?: boolean;
  requestAnimationFrameImpl: (cb: FrameRequestCallback) => number;
  cancelAnimationFrameImpl: (handle: number) => void;
  setTimeoutImpl: (cb: () => void, ms: number) => number;
  clearTimeoutImpl: (handle: number) => void;
  onSample?: (sample: FrameSamplerSample) => void;
}

const createHarness = async (props: HarnessProps) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const Harness = React.forwardRef<HarnessHandle, HarnessProps>((incomingProps, ref) => {
    const sampler = useFrameSampler({
      enabled: incomingProps.enabled ?? true,
      sampleLabel: 'GridTable scroll',
      sampleWindowMs: 100,
      minSampleCount: 2,
      onSample: incomingProps.onSample,
      requestAnimationFrameImpl: incomingProps.requestAnimationFrameImpl,
      cancelAnimationFrameImpl: incomingProps.cancelAnimationFrameImpl,
      setTimeoutImpl: incomingProps.setTimeoutImpl,
      clearTimeoutImpl: incomingProps.clearTimeoutImpl,
    });

    useImperativeHandle(ref, () => ({
      start: sampler.start,
      stop: sampler.stop,
    }));

    return null;
  });

  const ref = React.createRef<HarnessHandle>();

  await act(async () => {
    root.render(<Harness ref={ref} {...props} />);
  });

  return {
    start: () => ref.current?.start(),
    stop: (reason?: 'timeout' | 'manual' | 'unmount') => ref.current?.stop(reason),
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useFrameSampler', () => {
  it('does nothing when disabled', async () => {
    const raf = vi.fn();
    const setTimeoutImpl = vi.fn();

    const harness = await createHarness({
      enabled: false,
      requestAnimationFrameImpl: raf,
      cancelAnimationFrameImpl: vi.fn(),
      setTimeoutImpl,
      clearTimeoutImpl: vi.fn(),
    });

    harness.start();
    expect(raf).not.toHaveBeenCalled();
    expect(setTimeoutImpl).not.toHaveBeenCalled();

    await harness.unmount();
  });

  it('records frame deltas and reports stats on timeout', async () => {
    let rafId = 0;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    const timeoutCallbacks = new Map<number, () => void>();

    const requestAnimationFrameImpl = vi.fn((cb: FrameRequestCallback) => {
      rafId += 1;
      rafCallbacks.set(rafId, cb);
      return rafId;
    });
    const cancelAnimationFrameImpl = vi.fn((id: number) => {
      rafCallbacks.delete(id);
    });
    const setTimeoutImpl = vi.fn((cb: () => void) => {
      const id = timeoutCallbacks.size + 1;
      timeoutCallbacks.set(id, cb);
      return id;
    });
    const clearTimeoutImpl = vi.fn((id: number) => {
      timeoutCallbacks.delete(id);
    });
    const onSample = vi.fn();

    const harness = await createHarness({
      requestAnimationFrameImpl,
      cancelAnimationFrameImpl,
      setTimeoutImpl,
      clearTimeoutImpl,
      onSample,
    });

    harness.start();

    // flush initial frame to schedule subsequent ticks
    const firstCallback = rafCallbacks.get(1);
    expect(firstCallback).toBeDefined();
    firstCallback?.(0);

    const secondCallback = rafCallbacks.get(2);
    expect(secondCallback).toBeDefined();
    secondCallback?.(16.7);

    const thirdCallback = rafCallbacks.get(3);
    expect(thirdCallback).toBeDefined();
    thirdCallback?.(34);

    // trigger timeout to finalise sample
    const timeoutCb = timeoutCallbacks.get(1);
    expect(timeoutCb).toBeDefined();
    timeoutCb?.();

    expect(onSample).toHaveBeenCalledTimes(1);
    expect(onSample.mock.calls[0][0]).toMatchObject({
      sample: 'GridTable scroll',
      frames: 2,
      latestMs: 17.3,
    });

    await harness.unmount();
  });

  it('does not emit anything when no sample handler is provided', async () => {
    const consoleTable = vi.spyOn(console, 'table').mockImplementation(() => undefined);
    let rafId = 0;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    const timeoutCallbacks = new Map<number, () => void>();

    const harness = await createHarness({
      requestAnimationFrameImpl: (cb) => {
        rafId += 1;
        rafCallbacks.set(rafId, cb);
        return rafId;
      },
      cancelAnimationFrameImpl: (id) => {
        rafCallbacks.delete(id);
      },
      setTimeoutImpl: (cb) => {
        const id = timeoutCallbacks.size + 1;
        timeoutCallbacks.set(id, cb);
        return id;
      },
      clearTimeoutImpl: (id) => {
        timeoutCallbacks.delete(id);
      },
    });

    harness.start();
    rafCallbacks.get(1)?.(0);
    rafCallbacks.get(2)?.(16.7);
    rafCallbacks.get(3)?.(34);
    timeoutCallbacks.get(1)?.();

    expect(consoleTable).not.toHaveBeenCalled();

    await harness.unmount();
  });

  it('clears observers when stopped manually', async () => {
    let rafId = 0;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    const requestAnimationFrameImpl = vi.fn((cb: FrameRequestCallback) => {
      rafId += 1;
      rafCallbacks.set(rafId, cb);
      return rafId;
    });
    const cancelAnimationFrameImpl = vi.fn((id: number) => {
      rafCallbacks.delete(id);
    });
    const setTimeoutImpl = vi.fn((_cb: () => void) => 1);
    const clearTimeoutImpl = vi.fn();

    const harness = await createHarness({
      requestAnimationFrameImpl,
      cancelAnimationFrameImpl,
      setTimeoutImpl,
      clearTimeoutImpl,
    });

    harness.start();
    harness.stop('manual');

    expect(cancelAnimationFrameImpl).toHaveBeenCalled();
    expect(clearTimeoutImpl).toHaveBeenCalled();

    await harness.unmount();
  });
});
