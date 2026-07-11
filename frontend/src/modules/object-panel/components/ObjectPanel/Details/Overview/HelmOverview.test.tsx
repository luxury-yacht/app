/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/HelmOverview.test.tsx
 */

import { helm } from '@wailsjs/go/models';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { helmReleaseDescriptor } from './descriptors/helm';
import { OverviewRenderer } from './OverviewRenderer';

const openWithObjectMock = vi.fn();
const defaultClusterId = 'alpha:ctx';

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
    objectData: { clusterId: defaultClusterId, clusterName: 'alpha' },
  }),
}));

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: { kind: string; name: string }) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: { statusPresentation?: string; status?: string }) => (
    <div data-testid="resource-status" data-presentation={props.statusPresentation}>
      {props.status}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

describe('HelmOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  // The descriptor reads the raw helm.HelmReleaseDetails DTO; tests build one and render it through
  // the generic OverviewRenderer (the production dispatch path).
  const renderDescriptor = async (dto: helm.HelmReleaseDetails) => {
    await act(async () => {
      root.render(<OverviewRenderer descriptor={helmReleaseDescriptor} data={dto} />);
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
    await renderDescriptor(
      helm.HelmReleaseDetails.createFrom({
        name: 'api-release',
        namespace: 'prod',
        chart: 'api-chart',
        version: '1.2.3',
        appVersion: '2.0.0',
        status: 'Deployed',
        statusPresentation: 'ready',
        revision: 5,
        updated: '2024-01-01T00:00:00Z',
        description: 'Upgrade complete',
        resources: [
          {
            kind: 'Deployment',
            apiVersion: 'apps/v1',
            name: 'api',
            namespace: 'prod',
            scope: 'namespaced',
          },
          {
            kind: 'Service',
            apiVersion: 'v1',
            name: 'api-svc',
            namespace: 'prod',
            scope: 'namespaced',
          },
        ],
        history: [
          { revision: 5, status: 'Deployed', updated: '2024-01-01', chart: 'api-chart-1.2.3' },
          { revision: 4, status: 'Superseded', updated: '2023-12-01', chart: 'api-chart-1.1.0' },
          { revision: 3, status: 'Deployed', updated: '2023-11-01', chart: 'api-chart-1.0.0' },
          { revision: 2, status: 'Failed', updated: '2023-10-01', chart: 'api-chart-0.9.0' },
          { revision: 1, status: 'Deployed', updated: '2023-09-01', chart: 'api-chart-0.8.0' },
          { revision: 0, status: 'Pending', updated: '2023-08-01', chart: 'api-chart-0.7.0' },
        ],
        notes: 'Release notes',
      })
    );

    expect(getValueForLabel('Chart')?.textContent).toBe('api-chart');
    expect(
      container.querySelector('[data-testid="resource-status"]')?.getAttribute('data-presentation')
    ).toBe('ready');
    expect(getValueForLabel('Chart Version')?.textContent).toBe('1.2.3');
    expect(getValueForLabel('App Version')?.textContent).toBe('2.0.0');
    expect(getValueForLabel('Revision')?.textContent).toBe('5');
    expect(container.textContent).toContain('Release notes');

    const resourceLinks = container.querySelectorAll('.metadata-pair .object-panel-link');
    expect(resourceLinks.length).toBeGreaterThan(0);
    act(() => {
      resourceLinks[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Deployment',
        name: 'api',
        namespace: 'prod',
        clusterId: defaultClusterId,
      })
    );
    expect(container.textContent).toContain('... and 1 more revision(s)');
  });

  it('falls back to basic props when details are absent', async () => {
    await renderDescriptor(
      helm.HelmReleaseDetails.createFrom({
        name: 'fallback',
        namespace: 'default',
        chart: 'fallback-chart',
        status: 'Pending',
        labels: {},
        annotations: {},
      })
    );

    expect(getValueForLabel('Chart')?.textContent).toBe('fallback-chart');
    expect(container.textContent).toContain('Pending');
  });

  it('does not link managed resources whose scope is unknown', async () => {
    await renderDescriptor(
      helm.HelmReleaseDetails.createFrom({
        name: 'api-release',
        namespace: 'prod',
        status: 'Deployed',
        resources: [
          {
            kind: 'Database',
            apiVersion: 'databases.example.com/v1alpha1',
            name: 'orders',
            namespace: 'prod',
          },
          {
            kind: 'ClusterRole',
            apiVersion: 'rbac.authorization.k8s.io/v1',
            name: 'reader',
            namespace: '',
            scope: 'cluster',
          },
        ],
      })
    );

    const resourceLinks = container.querySelectorAll('.metadata-pair .object-panel-link');
    expect(resourceLinks).toHaveLength(1);
    act(() => {
      resourceLinks[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ClusterRole',
        name: 'reader',
        namespace: undefined,
        clusterId: defaultClusterId,
      })
    );
  });
});
