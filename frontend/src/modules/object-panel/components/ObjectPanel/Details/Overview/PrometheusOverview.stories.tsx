import { CurrentObjectPanelContext } from '@modules/object-panel/hooks/useObjectPanel';
import type { Meta, StoryObj } from '@storybook/react';
import type { CustomResourceDetails } from '@/core/refresh/types';
import { SidebarProvidersDecorator } from '../../../../../../../.storybook/decorators/SidebarProvidersDecorator';
import { getOverviewDescriptor } from './descriptorRegistry';
import { OverviewRenderer } from './OverviewRenderer';
import '../DetailsTab.css';
import '../../shared.css';
import '@/App.css';

function PrometheusOverviewPreview({ detail }: Readonly<{ detail: CustomResourceDetails }>) {
  const descriptor = getOverviewDescriptor(detail.kind, detail);
  return (
    <CurrentObjectPanelContext.Provider
      value={{ objectData: null, panelId: null, creationTimestamp: '2026-09-01T12:00:00Z' }}
    >
      <div className="app">
        <div className="object-panel-section">
          <div className="object-panel-section-title">Overview</div>
          <div className="object-panel-section-grid">
            {descriptor && <OverviewRenderer descriptor={descriptor} data={detail as never} />}
          </div>
        </div>
      </div>
    </CurrentObjectPanelContext.Provider>
  );
}

const base: CustomResourceDetails = {
  ref: {
    clusterId: 'story-cluster',
    group: 'monitoring.coreos.com',
    version: 'v1',
    kind: 'ServiceMonitor',
    namespace: 'payments',
    name: 'payments-api',
  },
  kind: 'ServiceMonitor',
  name: 'payments-api',
  resourceFamily: 'prometheus',
  status: '',
  statusPresentation: '',
  statusState: '',
  labels: { release: 'kube-prometheus-stack', team: 'payments' },
};

const serviceMonitor: CustomResourceDetails = {
  ...base,
  prometheus: {
    monitor: {
      selector: {
        matchLabels: {
          'app.kubernetes.io/name': 'payments-api',
          'app.kubernetes.io/component': 'api',
        },
        matchExpressions: [{ key: 'environment', operator: 'In', values: ['prod', 'staging'] }],
      },
      namespaceSelector: { any: false },
      jobLabel: 'app.kubernetes.io/name',
      targetLabels: ['team', 'app.kubernetes.io/version'],
      podTargetLabels: ['pod-template-hash'],
      sampleLimit: 50000,
      targetLimit: 200,
      endpoints: [
        {
          port: 'metrics',
          path: '/metrics',
          interval: '30s',
          scrapeTimeout: '10s',
          honorLabels: true,
        },
        {
          port: 'admin',
          path: '/actuator/prometheus',
          scheme: 'https',
          interval: '1m',
          honorTimestamps: false,
        },
        { targetPort: '9102' },
      ],
    },
  },
};

const meta: Meta<typeof PrometheusOverviewPreview> = {
  title: 'Object Panel/Prometheus Overview',
  component: PrometheusOverviewPreview,
  decorators: [SidebarProvidersDecorator],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof PrometheusOverviewPreview>;

export const ServiceMonitor: Story = { args: { detail: serviceMonitor } };
export const ServiceMonitorAllNamespaces: Story = {
  args: {
    detail: {
      ...serviceMonitor,
      name: 'kube-state-metrics',
      ref: { ...base.ref, name: 'kube-state-metrics', namespace: 'monitoring' },
      prometheus: {
        monitor: {
          selector: {},
          namespaceSelector: { any: true },
          endpoints: [{ port: 'http', interval: '15s' }],
        },
      },
    },
  },
};
export const PodMonitor: Story = {
  args: {
    detail: {
      ...base,
      kind: 'PodMonitor',
      name: 'payments-workers',
      ref: { ...base.ref, kind: 'PodMonitor', name: 'payments-workers' },
      prometheus: {
        monitor: {
          selector: { matchLabels: { 'app.kubernetes.io/name': 'payments-worker' } },
          namespaceSelector: { any: false, matchNames: ['payments', 'payments-canary'] },
          jobLabel: 'app.kubernetes.io/name',
          podTargetLabels: ['app.kubernetes.io/version'],
          endpoints: [
            { port: 'metrics', path: '/metrics', interval: '30s', scrapeTimeout: '10s' },
            { portNumber: 9187, path: '/db/metrics', interval: '1m' },
          ],
        },
      },
    },
  },
};
