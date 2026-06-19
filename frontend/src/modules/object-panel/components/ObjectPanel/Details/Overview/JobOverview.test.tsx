/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/JobOverview.test.tsx
 *
 * Exercises the Job and CronJob Overviews through the descriptor-driven renderer (X1).
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { job, cronjob } from '@wailsjs/go/models';
import { OverviewRenderer } from './OverviewRenderer';
import { jobDescriptor, cronJobDescriptor } from './descriptors/job';

const defaultClusterId = 'alpha:ctx';
const defaultClusterName = 'alpha';

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: vi.fn(),
    objectData: { clusterId: defaultClusterId, clusterName: defaultClusterName },
  }),
}));

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>,
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

  const renderJob = async (overrides: Record<string, unknown>) => {
    await act(async () => {
      root.render(
        <OverviewRenderer
          descriptor={jobDescriptor}
          data={job.JobDetails.createFrom(overrides)}
          context={{ clusterId: defaultClusterId, clusterName: defaultClusterName }}
        />
      );
      await Promise.resolve();
    });
  };

  const renderCronJob = async (overrides: Record<string, unknown>) => {
    await act(async () => {
      root.render(
        <OverviewRenderer
          descriptor={cronJobDescriptor}
          data={cronjob.CronJobDetails.createFrom(overrides)}
          context={{ clusterId: defaultClusterId, clusterName: defaultClusterName }}
        />
      );
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
    await renderJob({
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
    await renderCronJob({
      kind: 'CronJob',
      name: 'cron',
      schedule: '*/5 * * * *',
      suspend: true,
      activeJobs: [{}, {}],
      lastScheduleTime: '2024-01-01T00:00:00Z',
      successfulJobsHistory: 5,
      failedJobsHistory: 2,
    });

    expect(getValueForLabel(container, 'Schedule')?.textContent).toContain('*/5 * * * *');
    expect(getValueForLabel(container, 'Status')?.textContent).toContain('Suspended');
    expect(getValueForLabel(container, 'Active Jobs')?.textContent).toBe('2');
    // Run summary collapses all timestamps into a single Runs cell.
    const runs = getValueForLabel(container, 'Runs')?.textContent ?? '';
    expect(runs).toContain('Last Scheduled');
    expect(runs.toLowerCase()).toContain('ago');
    // Suspended cronjobs say "Suspended" in the Next Scheduled row.
    expect(runs).toContain('Suspended');
    // History only renders when limits differ from k8s defaults (3 / 1).
    expect(getValueForLabel(container, 'History Limits')?.textContent).toBe(
      '5 succeeded, 2 failed'
    );
  });

  it('surfaces cronjob next-run + last-successful in the Runs block', async () => {
    await renderCronJob({
      kind: 'CronJob',
      name: 'cron',
      schedule: '0 * * * *',
      nextScheduleTime: '2099-01-01T00:00:00Z',
      lastSuccessfulTime: '2024-01-01T00:00:00Z',
      concurrencyPolicy: 'Forbid',
    });

    const runs = getValueForLabel(container, 'Runs')?.textContent ?? '';
    expect(runs).toMatch(/Next Scheduledin \d+/);
    expect(runs).toMatch(/Last Success.*ago/);
    expect(getValueForLabel(container, 'Concurrency')?.textContent).toContain('Forbid');
  });

  // Note: CronJob trigger/suspend actions are tested in ActionsMenu.test.tsx
  // since they now appear in the triple-dot menu rather than inline buttons
});
