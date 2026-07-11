/**
 * frontend/src/shared/components/tables/hooks/useGridTableProfiler.test.tsx
 *
 * Test suite for useGridTableProfiler.
 * Covers key behaviors and edge cases for useGridTableProfiler.
 */

import { useGridTableProfiler } from '@shared/components/tables/hooks/useGridTableProfiler';
import React, { act, useImperativeHandle } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const startMock = vi.fn();
const stopMock = vi.fn();

vi.mock('./useFrameSampler', () => ({
  useFrameSampler: () => ({ start: startMock, stop: stopMock }),
}));

type HarnessHandle = {
  start: () => void;
  stop: (reason?: 'timeout' | 'manual' | 'unmount') => void;
  wrap: (content: React.ReactElement) => React.ReactElement;
  warn: (message: string) => void;
  isEnabled: () => boolean;
};

const createHarness = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const ref = React.createRef<HarnessHandle>();

  const Harness = ({ ref: profilerRef }: { ref?: React.Ref<HarnessHandle> }) => {
    const profiler = useGridTableProfiler();

    useImperativeHandle(profilerRef, () => ({
      start: profiler.startFrameSampler,
      stop: profiler.stopFrameSampler,
      wrap: profiler.wrapWithProfiler,
      warn: profiler.warnDevOnce,
      isEnabled: () => profiler.profilerEnabled,
    }));

    return null;
  };

  await act(async () => {
    root.render(<Harness ref={ref} />);
  });

  return {
    handle: () => {
      if (!ref.current) {
        throw new Error('Harness not initialised');
      }
      return ref.current;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const originalUserAgent = navigator.userAgent;

afterEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(navigator, 'userAgent', {
    value: originalUserAgent,
    configurable: true,
  });
  vi.restoreAllMocks();
  startMock.mockReset();
  stopMock.mockReset();
});

describe('useGridTableProfiler', () => {
  it('disables profiler inside jsdom', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'jsdom-test',
      configurable: true,
    });
    const harness = await createHarness();
    expect(harness.handle().isEnabled()).toBe(false);
    await harness.unmount();
  });

  it('wraps content with React Profiler when enabled', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'chrome',
      configurable: true,
    });
    Object.defineProperty(import.meta.env, 'VITE_GRIDTABLE_PROFILE_LOGS', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: 'true',
    });
    const harness = await createHarness();
    const wrapped = harness.handle().wrap(<div data-testid="content" />);
    expect(wrapped.type).toBe(React.Profiler);

    harness.handle().start();
    harness.handle().stop('manual');
    expect(startMock).toHaveBeenCalled();
    expect(stopMock).toHaveBeenCalledWith('manual');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness.handle().warn('duplicate');
    harness.handle().warn('duplicate');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();

    await harness.unmount();
  });
});
