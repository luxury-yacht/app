/**
 * frontend/src/shared/components/drain/DrainProgressCard.test.tsx
 *
 * Status-pill rendering contract for drain jobs: every member of the closed
 * NodeMaintenanceDrainJob['status'] union maps to a pinned label and style,
 * and a value outside the union must throw instead of silently rendering as
 * success (the pre-typed helpers fell through to the green 'success' class).
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NodeMaintenanceDrainJob } from '@/core/refresh/types';
import { DrainProgressCard } from './DrainProgressCard';

const buildJob = (status: NodeMaintenanceDrainJob['status']): NodeMaintenanceDrainJob => ({
  clusterId: 'cluster-1',
  id: 'drain-1',
  nodeName: 'node-1',
  status,
  startedAt: 1700000000000,
  options: {
    ignoreDaemonSets: true,
    deleteEmptyDirData: false,
    force: false,
    disableEviction: false,
    skipWaitForPodsToTerminate: false,
  },
  events: [],
});

describe('DrainProgressCard status pill', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderStatus = (status: NodeMaintenanceDrainJob['status']) => {
    act(() => {
      root.render(<DrainProgressCard job={buildJob(status)} isActive={false} />);
    });
    const pill = container.querySelector('[data-test="drain-job-status"]');
    if (!(pill instanceof HTMLElement)) {
      throw new Error('Expected drain job status pill');
    }
    return pill;
  };

  it.each([
    ['running', 'Running', 'info'],
    ['canceling', 'Canceling', 'warning'],
    ['cancelled', 'Cancelled', 'warning'],
    ['failed', 'Failed', 'error'],
    ['succeeded', 'Completed', 'success'],
  ] as const)('renders %s as "%s" with the %s style', (status, label, statusClass) => {
    const pill = renderStatus(status);
    expect(pill.textContent).toBe(label);
    expect(pill.classList.contains(statusClass)).toBe(true);
  });

  it('throws on a status outside the union instead of rendering success', () => {
    // Guards the assertNever boundary: a future backend status that reaches
    // the card unhandled must fail loudly, not render as a green "Completed".
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => {
      act(() => {
        root.render(<DrainProgressCard job={buildJob('paused' as never)} isActive={false} />);
      });
    }).toThrow();
    consoleError.mockRestore();
    // afterEach unmount needs a fresh root once a render has thrown.
    root = ReactDOM.createRoot(container);
  });
});
