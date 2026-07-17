import type { events } from '@wailsjs/go/models';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventDescriptor } from './descriptors/event';
import { OverviewRenderer } from './OverviewRenderer';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: { kind: string; name: string }) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: { status?: string; customLabel?: string }) => (
    <div>
      <span className="overview-label">{props.customLabel ?? 'Status'}</span>
      <span className="overview-value" data-testid="resource-status">
        {props.status}
      </span>
    </div>
  ),
}));

vi.mock('@shared/components/LiveAgeText', () => ({
  LiveAgeText: ({ timestamp }: { timestamp: string }) => <span>{timestamp}</span>,
}));

vi.mock('@shared/components/ObjectPanelLink', () => ({
  ObjectPanelLink: ({ children }: React.PropsWithChildren) => <a href="/object">{children}</a>,
}));

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (element) => element.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('EventOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders the complete Event operational context and object links', async () => {
    const dto = {
      kind: 'Event',
      name: 'orders.123',
      namespace: 'apps',
      status: 'Warning',
      statusState: 'Warning',
      statusPresentation: 'warning',
      eventType: 'Warning',
      reason: 'BackOff',
      message: 'Back-off restarting failed container',
      count: 4,
      firstTimestamp: '2026-01-03T12:00:00Z',
      lastTimestamp: '2026-01-03T12:05:00Z',
      eventTime: '2026-01-03T12:00:01Z',
      seriesCount: 7,
      seriesLastObservedTime: '2026-01-03T12:05:01Z',
      source: 'kubelet on node-a',
      action: 'Killing',
      reportingController: 'kubernetes.io/kubelet',
      reportingInstance: 'kubelet-node-a',
      involvedObject: {
        ref: {
          clusterId: 'cluster-a',
          group: '',
          version: 'v1',
          kind: 'Pod',
          namespace: 'apps',
          name: 'orders-abc',
        },
      },
      involvedObjectFieldPath: 'spec.containers{api}',
      relatedObject: {
        ref: {
          clusterId: 'cluster-a',
          group: '',
          version: 'v1',
          kind: 'Node',
          name: 'node-a',
        },
      },
      relatedObjectFieldPath: 'status.conditions{Ready}',
      labels: {},
      annotations: {},
    } as unknown as events.EventDetails;

    await act(async () => {
      root.render(
        <OverviewRenderer
          descriptor={eventDescriptor}
          data={dto}
          context={{ clusterId: 'cluster-a', clusterName: 'alpha' }}
        />
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="resource-status"]')?.textContent).toBe('Warning');
    expect(getValueForLabel(container, 'Type')?.textContent).toBe('Warning');
    expect(getValueForLabel(container, 'Status')).toBeNull();
    expect(getValueForLabel(container, 'Object')?.textContent).toBe('Pod/orders-abc');
    expect(getValueForLabel(container, 'Object')?.querySelector('a')).toBeTruthy();
    expect(getValueForLabel(container, 'Reason')?.textContent).toBe('BackOff');
    expect(getValueForLabel(container, 'Message')?.textContent).toBe(
      'Back-off restarting failed container'
    );
    expect(getValueForLabel(container, 'Count')?.textContent).toBe('4');
    expect(getValueForLabel(container, 'First Seen')?.textContent).toBe('2026-01-03T12:00:00Z');
    expect(getValueForLabel(container, 'Last Seen')?.textContent).toBe('2026-01-03T12:05:00Z');
    expect(getValueForLabel(container, 'Event Time')?.textContent).toBe('2026-01-03T12:00:01Z');
    expect(getValueForLabel(container, 'Series Count')?.textContent).toBe('7');
    expect(getValueForLabel(container, 'Series Last Seen')?.textContent).toBe(
      '2026-01-03T12:05:01Z'
    );
    expect(getValueForLabel(container, 'Source')?.textContent).toBe('kubelet on node-a');
    expect(getValueForLabel(container, 'Action')?.textContent).toBe('Killing');
    expect(getValueForLabel(container, 'Controller')?.textContent).toBe('kubernetes.io/kubelet');
    expect(getValueForLabel(container, 'Reporting Instance')?.textContent).toBe('kubelet-node-a');
    expect(getValueForLabel(container, 'Subobject')?.textContent).toBe('spec.containers{api}');
    expect(getValueForLabel(container, 'Related Object')?.textContent).toBe('Node/node-a');
    expect(getValueForLabel(container, 'Related Object')?.querySelector('a')).toBeTruthy();
    expect(getValueForLabel(container, 'Related Subobject')?.textContent).toBe(
      'status.conditions{Ready}'
    );
  });
});
