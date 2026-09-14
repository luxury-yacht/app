import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CustomResourceDetails, PrometheusMonitor } from '@/core/refresh/types';
import { getOverviewDescriptor } from './descriptorRegistry';
import { OverviewRenderer } from './OverviewRenderer';
import { PrometheusSections } from './PrometheusSections';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({ ResourceHeader: () => null }));
vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({ ResourceMetadata: () => null }));
vi.mock('@shared/components/Tooltip', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@shared/components/ObjectPanelLink', () => ({
  ObjectPanelLink: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const mount = (monitor: PrometheusMonitor, kind = 'ServiceMonitor', namespace = 'payments') => {
  const dom = document.createElement('div');
  dom.innerHTML = renderToStaticMarkup(
    <PrometheusSections facts={{ monitor }} kind={kind} namespace={namespace} />
  );
  return dom;
};

const rowValue = (dom: HTMLElement, label: string) =>
  [...dom.querySelectorAll('.overview-item')]
    .find((item) => item.querySelector('.overview-label')?.textContent === label)
    ?.querySelector('.overview-value')?.textContent;

const cards = (dom: HTMLElement) =>
  [...dom.querySelectorAll('.overview-card')].map((card) => ({
    title: card.querySelector('.overview-card-title')?.textContent,
    meta: card.querySelector('.overview-card-meta')?.textContent ?? '',
    tag: card.querySelector('.overview-card-tag')?.textContent ?? '',
    rows: [...card.querySelectorAll('.overview-item')].map((row) => [
      row.querySelector('.overview-label')?.textContent,
      row.querySelector('.overview-value')?.textContent,
    ]),
  }));

describe('Prometheus monitor targets', () => {
  it('names the selected kind and resolves the same-namespace default to the object namespace', () => {
    const dom = mount({
      selector: {
        matchLabels: { app: 'payments-api' },
        matchExpressions: [{ key: 'environment', operator: 'In', values: ['prod', 'staging'] }],
      },
      namespaceSelector: { any: false },
      sampleLimit: 0,
      targetLimit: 200,
    });
    expect(rowValue(dom, 'Services')).toBe('app=payments-apienvironment In prod, staging');
    expect(rowValue(dom, 'Pods')).toBeUndefined();
    expect(rowValue(dom, 'Namespaces')).toBe('payments (same namespace)');
    expect(rowValue(dom, 'Sample Limit')).toBe('0');
    expect(rowValue(dom, 'Target Limit')).toBe('200');
  });

  it('labels pod selection, lists explicit namespaces, and reports an empty selector as all', () => {
    const dom = mount(
      {
        selector: {},
        namespaceSelector: { any: false, matchNames: ['payments', 'payments-canary'] },
        podTargetLabels: ['app.kubernetes.io/version'],
      },
      'PodMonitor'
    );
    expect(rowValue(dom, 'Pods')).toBe('All');
    expect(rowValue(dom, 'Namespaces')).toBe('paymentspayments-canary');
    expect(rowValue(dom, 'Pod Target Labels')).toBe('app.kubernetes.io/version');
    expect(rowValue(dom, 'Services')).toBeUndefined();
  });

  it('reports the any namespace selector as all namespaces', () => {
    const dom = mount({ selector: {}, namespaceSelector: { any: true } });
    expect(rowValue(dom, 'Namespaces')).toBe('All namespaces');
  });
});

describe('Prometheus scrape endpoints', () => {
  it('summarises each endpoint by port, scheme and path, and cadence without inventing defaults', () => {
    const dom = mount({
      selector: {},
      namespaceSelector: { any: false },
      endpoints: [
        {
          port: 'metrics',
          path: '/metrics',
          interval: '30s',
          scrapeTimeout: '10s',
          honorLabels: true,
        },
        { port: 'admin', scheme: 'https', path: '/actuator/prometheus', honorTimestamps: false },
        { targetPort: '9102' },
        { portNumber: 9187, interval: '1m' },
        {},
      ],
    });
    expect(cards(dom)).toEqual([
      {
        title: 'metrics',
        meta: '/metrics',
        tag: 'every 30s · timeout 10s',
        rows: [['Honor Labels', 'true']],
      },
      {
        title: 'admin',
        meta: 'https /actuator/prometheus',
        tag: '',
        rows: [['Honor Timestamps', 'false']],
      },
      { title: '9102', meta: 'targetPort', tag: '', rows: [] },
      { title: '9187', meta: 'portNumber', tag: 'every 1m', rows: [] },
      { title: 'Endpoint 5', meta: '', tag: '', rows: [] },
    ]);
    expect(dom.textContent).not.toContain('http /');
  });

  it('keeps a numeric target port visible when a named port is also set', () => {
    const dom = mount({
      selector: {},
      namespaceSelector: { any: false },
      endpoints: [{ port: 'metrics', targetPort: '9102' }],
    });
    expect(cards(dom)).toEqual([
      { title: 'metrics', meta: '', tag: '', rows: [['Target Port', '9102']] },
    ]);
  });
});

describe('Prometheus monitor overview wiring', () => {
  it('resolves the same-namespace default from the object reference through the descriptor', () => {
    const detail: CustomResourceDetails = {
      ref: {
        clusterId: 'a',
        group: 'monitoring.coreos.com',
        version: 'v1',
        kind: 'PodMonitor',
        namespace: 'payments',
        name: 'workers',
      },
      kind: 'PodMonitor',
      name: 'workers',
      resourceFamily: 'prometheus',
      status: 'Unknown',
      statusState: 'unknown',
      statusPresentation: 'unknown',
      prometheus: {
        monitor: {
          selector: { matchLabels: { app: 'worker' } },
          namespaceSelector: { any: false },
          endpoints: [{ port: 'metrics' }],
        },
      },
    };
    const descriptor = getOverviewDescriptor('PodMonitor', detail);
    if (!descriptor) {
      throw new Error('operator descriptor missing');
    }
    const dom = document.createElement('div');
    dom.innerHTML = renderToStaticMarkup(
      <OverviewRenderer descriptor={descriptor} data={detail as never} />
    );
    expect(rowValue(dom, 'Pods')).toBe('app=worker');
    expect(rowValue(dom, 'Namespaces')).toBe('payments (same namespace)');
    expect([...dom.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
      'Targets',
      'Scrape Endpoints',
    ]);
  });
});
