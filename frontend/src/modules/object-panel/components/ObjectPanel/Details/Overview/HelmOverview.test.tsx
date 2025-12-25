/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/HelmOverview.test.tsx
 *
 * Tests for HelmOverview.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HelmOverview } from './HelmOverview';

const openWithObjectMock = vi.fn();

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: any) => <div data-testid="resource-status">{props.status}</div>,
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

describe('HelmOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof HelmOverview>) => {
    await act(async () => {
      root.render(<HelmOverview {...props} />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    openWithObjectMock.mockReset();
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

  const getValueForLabel = (label: string) => {
    const labelElement = Array.from(
      container.querySelectorAll<HTMLElement>('.overview-label')
    ).find((el) => el.textContent?.trim() === label);
    return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
  };

  it('renders helm release details and supports navigation to managed resources', async () => {
    await renderComponent({
      helmReleaseDetails: {
        name: 'api-release',
        namespace: 'prod',
        age: '1d',
        chart: 'api-chart',
        version: '1.2.3',
        appVersion: '2.0.0',
        status: 'Deployed',
        revision: 5,
        updated: '2024-01-01T00:00:00Z',
        description: 'Upgrade complete',
        resources: [
          { kind: 'Deployment', name: 'api', namespace: 'prod' },
          { kind: 'Service', name: 'api-svc', namespace: 'prod' },
        ],
        history: [
          { revision: 5, status: 'Deployed', updated: '2024-01-01', chart: 'api-chart-1.2.3' },
          { revision: 4, status: 'Superseded', updated: '2023-12-01', chart: 'api-chart-1.1.0' },
          { revision: 3, status: 'Deployed', updated: '2023-11-01', chart: 'api-chart-1.0.0' },
          { revision: 2, status: 'Failed', updated: '2023-10-01', chart: 'api-chart-0.9.0' },
          { revision: 1, status: 'Deployed', updated: '2023-09-01', chart: 'api-chart-0.8.0' },
          { revision: 0, status: 'Pending', updated: '2023-08-01', chart: 'api-chart-0.7.0' },
        ] as any,
        notes: 'Release notes',
      } as any,
    });

    expect(getValueForLabel('Chart')?.textContent).toBe('api-chart');
    expect(getValueForLabel('Chart Version')?.textContent).toBe('1.2.3');
    expect(getValueForLabel('App Version')?.textContent).toBe('2.0.0');
    expect(getValueForLabel('Revision')?.textContent).toBe('5');
    expect(container.textContent).toContain('Release notes');

    const resourceLinks = container.querySelectorAll('.metadata-pair .object-panel-link');
    expect(resourceLinks.length).toBeGreaterThan(0);
    act(() => {
      resourceLinks[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openWithObjectMock).toHaveBeenCalledWith({
      kind: 'deployment',
      name: 'api',
      namespace: 'prod',
    });
    expect(container.textContent).toContain('... and 1 more revision(s)');
  });

  it('falls back to basic props when details are absent', async () => {
    await renderComponent({
      name: 'fallback',
      namespace: 'default',
      chart: 'fallback-chart',
      status: 'Pending',
      labels: {},
      annotations: {},
    });

    expect(getValueForLabel('Chart')?.textContent).toBe('fallback-chart');
    expect(container.textContent).toContain('Pending');
  });
});
