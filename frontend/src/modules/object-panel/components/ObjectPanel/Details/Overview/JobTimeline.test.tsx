/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/JobTimeline.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JobTimeline } from './JobTimeline';

describe('JobTimeline', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderTimeline = async (props: React.ComponentProps<typeof JobTimeline>) => {
    await act(async () => {
      root.render(<JobTimeline {...props} />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    // Pin "now" so window math is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('renders a bar per in-window run, colored by status', async () => {
    await renderTimeline({
      jobs: [
        {
          name: 'job-success',
          status: 'Complete',
          startTime: '2024-06-15T11:00:00Z',
          durationSeconds: 60,
        },
        {
          name: 'job-failed',
          status: 'Failed',
          startTime: '2024-06-15T10:00:00Z',
          durationSeconds: 30,
        },
        {
          name: 'job-too-old',
          status: 'Complete',
          // 3 days old → outside default 24h window.
          startTime: '2024-06-12T10:00:00Z',
          durationSeconds: 60,
        },
      ],
    });

    const bars = container.querySelectorAll('.job-timeline-bar');
    // Two of three are inside the 24h window.
    expect(bars).toHaveLength(2);
    expect(container.querySelector('.job-timeline-bar--healthy')).toBeTruthy();
    expect(container.querySelector('.job-timeline-bar--unhealthy')).toBeTruthy();
  });

  it('shows empty-state copy when no runs fall within the window', async () => {
    await renderTimeline({
      jobs: [
        {
          name: 'too-old',
          status: 'Complete',
          startTime: '2024-06-10T00:00:00Z',
          durationSeconds: 10,
        },
      ],
    });

    expect(container.textContent).toContain('No runs in last');
  });

  it('switches window via the chip buttons and re-filters', async () => {
    await renderTimeline({
      jobs: [
        {
          name: 'four-hours-ago',
          status: 'Complete',
          // Outside the default 3h window, inside 12h.
          startTime: '2024-06-15T08:00:00Z',
          durationSeconds: 60,
        },
      ],
    });

    // Default 3h: hidden.
    expect(container.querySelectorAll('.job-timeline-bar')).toHaveLength(0);
    expect(container.textContent).toContain('No runs in last 3h');

    // Switch to 12h — should appear.
    const twelveHourBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.job-timeline-window')
    ).find((b) => b.textContent === '12h');
    expect(twelveHourBtn).toBeTruthy();
    await act(async () => {
      twelveHourBtn!.click();
    });
    expect(container.querySelectorAll('.job-timeline-bar')).toHaveLength(1);
  });
});
