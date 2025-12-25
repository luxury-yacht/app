/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/JobOverview.test.tsx
 *
 * Test suite for JobOverview.
 * Covers key behaviors and edge cases for JobOverview.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JobOverview } from './JobOverview';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('JobOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof JobOverview>) => {
    await act(async () => {
      root.render(<JobOverview {...props} />);
      await Promise.resolve();
    });
  };

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

  it('renders job status details including active/failed counts', async () => {
    await renderComponent({
      kind: 'Job',
      name: 'batch-job',
      completions: 3,
      succeeded: 2,
      active: 1,
      failed: 1,
      duration: '5m',
      parallelism: 4,
      backoffLimit: 5,
    });

    expect(getValueForLabel(container, 'Completions')?.textContent).toContain('2/3');
    expect(getValueForLabel(container, 'Active')?.textContent).toBe('1');
    expect(getValueForLabel(container, 'Failed')?.textContent).toBe('1');
    expect(getValueForLabel(container, 'Duration')?.textContent).toBe('5m');
    expect(getValueForLabel(container, 'Parallelism')?.textContent).toBe('4');
    expect(getValueForLabel(container, 'Backoff Limit')?.textContent).toBe('5');
  });

  it('renders cronjob schedule, status, and history', async () => {
    await renderComponent({
      kind: 'CronJob',
      name: 'cron',
      schedule: '*/5 * * * *',
      suspend: true,
      activeJobs: [{}, {}],
      lastScheduleTime: '2024-01-01T00:00:00Z',
      successfulJobsHistory: 3,
      failedJobsHistory: 1,
    } as any);

    expect(getValueForLabel(container, 'Schedule')?.textContent).toContain('*/5 * * * *');
    expect(getValueForLabel(container, 'Status')?.textContent).toContain('Suspended');
    expect(getValueForLabel(container, 'Active Jobs')?.textContent).toBe('2');
    expect(getValueForLabel(container, 'Last Scheduled')?.textContent).toContain('2024-01-01');
    expect(getValueForLabel(container, 'History')?.textContent).toBe('3 succeeded, 1 failed');
  });
});
