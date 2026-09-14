import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CustomResourceDetails } from '@/core/refresh/types';
import { getOverviewDescriptor } from './descriptorRegistry';
import { OverviewRenderer } from './OverviewRenderer';

vi.mock('@core/contexts/ZoomContext', () => ({ useZoom: () => ({ zoomLevel: 1 }) }));
vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({ ResourceHeader: () => null }));
vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({ ResourceMetadata: () => null }));
vi.mock('@shared/components/ObjectPanelLink', () => ({
  ObjectPanelLink: ({ objectRef }: { objectRef: { namespace: string; name: string } }) => (
    <button type="button">
      {objectRef.namespace}/{objectRef.name}
    </button>
  ),
}));
const base: CustomResourceDetails = {
  ref: {
    clusterId: 'a',
    group: 'argoproj.io',
    version: 'v1alpha1',
    kind: 'Application',
    namespace: 'team-a',
    name: 'shop',
  },
  resourceFamily: 'argocd',
  kind: 'Application',
  name: 'shop',
  status: 'Degraded',
  statusState: 'Degraded',
  statusPresentation: 'error',
};
function render(data: CustomResourceDetails) {
  const descriptor = getOverviewDescriptor(data.kind, data);
  if (!descriptor) {
    throw new Error('Argo CD overview missing');
  }
  return renderToStaticMarkup(<OverviewRenderer descriptor={descriptor} data={data as never} />);
}
const mount = (data: CustomResourceDetails) => {
  const dom = document.createElement('div');
  dom.innerHTML = render(data);
  return dom;
};
const rowValue = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll('.overview-item')]
    .find((item) => item.querySelector('.overview-label')?.textContent === label)
    ?.querySelector('.overview-value')?.textContent;
const headings = (dom: HTMLElement) =>
  [...dom.querySelectorAll('h3')].map((heading) => heading.textContent);
const cards = (scope: ParentNode) =>
  [...scope.querySelectorAll('.overview-card')].map((card) => ({
    title: card.querySelector('.overview-card-title')?.textContent,
    meta: card.querySelector('.overview-card-meta')?.textContent ?? '',
    tag: card.querySelector('.overview-card-tag')?.textContent ?? '',
    rows: [...card.querySelectorAll('.overview-item')].map((row) => [
      row.querySelector('.overview-label')?.textContent,
      row.querySelector('.overview-value')?.textContent,
    ]),
  }));
const section = (dom: HTMLElement, label: string) =>
  dom.querySelector(`section[aria-label="${label}"]`) ?? document.createElement('div');
describe('Argo CD overview', () => {
  it('shows independent sync and health, multiple sources, disabled automation and the namespaced owner', () => {
    const html = render({
      ...base,
      argoCD: {
        application: {
          spec: {
            project: 'production',
            destination: {
              server: 'https://prod.example.com',
              resolvedName: 'remote-prod',
              namespace: 'store',
            },
            sources: [
              {
                repoURL: 'https://git.example.com/config',
                path: 'apps/shop',
                targetRevision: 'main',
              },
              { repoURL: 'https://charts.example.com', chart: 'store', targetRevision: '2.1.0' },
            ],
            syncPolicy: {
              automated: { enabled: false, prune: true, selfHeal: false, allowEmpty: false },
            },
          },
          sync: 'Synced',
          syncPresentation: 'ready',
          health: 'Degraded',
          healthPresentation: 'error',
          resourceCount: 0,
          revisions: ['abc123', '2.1.0'],
          operation: {
            phase: 'Failed',
            message: 'Apply failed',
            startedAt: '2026-09-01T00:00:00Z',
          },
          applicationSet: { ref: { ...base.ref, kind: 'ApplicationSet', name: 'shops' } },
        },
      },
    });
    for (const value of [
      'Synced',
      'Degraded',
      'remote-prod',
      'store',
      'apps/shop',
      '2.1.0',
      'Disabled',
      'team-a/shops',
    ]) {
      expect(html).toContain(value);
    }
  });
  it('renders ApplicationSet template and generation errors, then project policy without application placeholders', () => {
    const set = render({
      ...base,
      kind: 'ApplicationSet',
      argoCD: {
        applicationSet: {
          template: { project: '{{project}}', destination: { name: '{{cluster}}' } },
          generators: [
            { type: 'matrix' },
            { type: 'git', repoURL: 'https://git.example.com/config' },
          ],
        },
        conditions: [
          {
            type: 'ErrorOccurred',
            status: 'True',
            presentation: 'error',
            message: 'Invalid template',
          },
        ],
      },
    });
    expect(set).toContain('matrix');
    expect(set).toContain('{{project}}');
    expect(set).toContain('ErrorOccurred');
    const project = render({
      ...base,
      kind: 'AppProject',
      argoCD: {
        project: {
          sourceRepos: ['https://git.example.com/*'],
          sourceNamespaces: ['team-*'],
          syncWindows: [
            {
              kind: 'deny',
              schedule: '0 22 * * *',
              duration: '8h',
              manualSync: true,
              andOperator: false,
              applications: ['store'],
              namespaces: ['store-*'],
              clusters: ['prod'],
            },
          ],
          destinations: [{ server: 'https://prod.example.com', namespace: 'store-*' }],
          roles: [
            {
              name: 'reader',
              groups: ['team-readers'],
              policies: ['p, proj:production:reader, applications, get, production/*, allow'],
            },
          ],
          clusterResourceWhitelist: [{ group: '', kind: 'Namespace' }],
        },
      },
    });
    expect(project).toContain('store-*');
    expect(project).toContain('reader');
    expect(project).toContain('Namespace');
    expect(project).not.toContain('Sync Policy');
  });
  it('keeps unrelated custom resources on their existing fallback', () => {
    expect(getOverviewDescriptor('Application', { ...base, resourceFamily: '' })).toBeUndefined();
  });

  it('leads an Application with health, sync and the last operation before its identity rows', () => {
    const dom = mount({
      ...base,
      argoCD: {
        application: {
          spec: {
            project: 'production',
            destination: {
              server: 'https://prod.example.com',
              resolvedName: 'remote-prod',
              namespace: 'store',
            },
            source: { repoURL: 'https://git.example.com/config.git', path: 'apps/shop' },
          },
          sync: 'OutOfSync',
          syncPresentation: 'warning',
          health: 'Degraded',
          healthPresentation: 'error',
          healthMessage: 'Deployment "shop" has 0/3 available replicas',
          resourceCount: 27,
          operation: {
            phase: 'Failed',
            phasePresentation: 'error',
            message: 'Apply failed',
            startedAt: '2026-09-01T00:00:00Z',
            finishedAt: '2026-09-01T00:00:04Z',
          },
        },
        conditions: [{ type: 'SyncError', presentation: 'error', message: 'apply failed' }],
      },
    });
    const health = rowValue(dom, 'Health');
    expect(health).toContain('Degraded');
    expect(health).toContain('Deployment "shop" has 0/3 available replicas');
    expect(rowValue(dom, 'Sync')).toContain('OutOfSync');
    const lastSync = rowValue(dom, 'Last Sync');
    expect(lastSync).toContain('Failed');
    expect(lastSync).toContain('Apply failed');
    expect(dom.querySelector('.status-chip--unhealthy')?.textContent).toBe('Degraded');
    expect(rowValue(dom, 'Conditions')).toContain('SyncError');
    expect(rowValue(dom, 'Project')).toBe('production');
    expect(rowValue(dom, 'Destination')).toContain('remote-prod');
    expect(rowValue(dom, 'Destination')).toContain('https://prod.example.com');
    expect(rowValue(dom, 'Namespace')).toBe('store');
    expect(rowValue(dom, 'Managed Resources')).toBe('27');
    // Destination and the last operation are rows now; only the spec lists remain sections.
    expect(headings(dom)).toEqual(['Sources', 'Sync Policy']);
    expect(rowValue(dom, 'Status')).toBeUndefined();
  });
  it.each([
    ['trailing slashes', 'https://git.example.com/platform/deploy-config.git///'],
    ['long internal slash runs', `https://git.example.com/${'/'.repeat(10_000)}deploy-config.git`],
  ])('extracts the repository name from sources with %s', (_description, repoURL) => {
    const dom = mount({
      ...base,
      argoCD: { application: { spec: { destination: {}, source: { repoURL } } } },
    });
    const source = cards(section(dom, 'Sources'))[0];
    expect(source.title).toBe('deploy-config');
    expect(source.rows).toEqual([['Repository', repoURL]]);
  });

  it('titles source cards from name, chart or repository, keeps revisions separate and summarises automation', () => {
    const application = {
      spec: {
        project: 'production',
        destination: { server: 'https://prod.example.com', namespace: 'store' },
        sources: [
          {
            repoURL: 'https://git.example.com/platform/deploy-config.git',
            path: 'apps/shop',
            targetRevision: 'main',
          },
          { repoURL: 'https://charts.example.com', chart: 'shop', targetRevision: '2.1.0' },
          { repoURL: 'https://git.example.com/platform/values.git', ref: 'values', name: 'values' },
        ],
        syncPolicy: {
          automated: { prune: true, selfHeal: true, allowEmpty: false },
          syncOptions: ['CreateNamespace=true'],
        },
      },
      revisions: ['abc123', '2.1.0', 'def456'],
    };
    const dom = mount({ ...base, argoCD: { application } });
    expect(cards(section(dom, 'Sources'))).toEqual([
      {
        title: 'deploy-config',
        meta: 'apps/shop',
        tag: 'main',
        rows: [['Repository', 'https://git.example.com/platform/deploy-config.git']],
      },
      {
        title: 'shop',
        meta: '',
        tag: '2.1.0',
        rows: [['Repository', 'https://charts.example.com']],
      },
      {
        title: 'values',
        meta: '',
        tag: '',
        rows: [
          ['Repository', 'https://git.example.com/platform/values.git'],
          ['Ref', 'values'],
        ],
      },
    ]);
    expect(rowValue(section(dom, 'Sources'), 'Deployed Revisions')).toBe('abc1232.1.0def456');
    expect(rowValue(dom, 'Automated Sync')).toBe('Enabled · prune · self heal');
    expect(rowValue(dom, 'Sync Options')).toBe('CreateNamespace=true');
    const manual = mount({
      ...base,
      argoCD: {
        application: { ...application, spec: { ...application.spec, syncPolicy: undefined } },
      },
    });
    expect(rowValue(manual, 'Automated Sync')).toBe('Disabled');
  });
  it('folds the ApplicationSet template into rows and summarises generators as cards', () => {
    const dom = mount({
      ...base,
      kind: 'ApplicationSet',
      argoCD: {
        applicationSet: {
          templateName: '{{.cluster}}-shop',
          goTemplate: true,
          template: {
            project: 'production',
            destination: { name: '{{.cluster}}', namespace: 'shop' },
          },
          generators: [
            { type: 'matrix' },
            { type: 'git', repoURL: 'https://git.example.com/config', revision: 'main' },
          ],
          strategy: 'RollingSync',
          applicationsSync: 'create-update',
          preserveResourcesOnDeletion: true,
        },
        conditions: [{ type: 'ResourcesUpToDate', status: 'True', presentation: 'ready' }],
      },
    });
    expect(rowValue(dom, 'Status')).toContain('Degraded');
    expect(rowValue(dom, 'Template')).toBe('{{.cluster}}-shop');
    expect(rowValue(dom, 'Project')).toBe('production');
    expect(rowValue(dom, 'Destination')).toBe('{{.cluster}}');
    expect(rowValue(dom, 'Namespace')).toBe('shop');
    expect(rowValue(dom, 'Go Template')).toBe('Yes');
    expect(cards(section(dom, 'Generators'))).toEqual([
      { title: 'matrix', meta: '', tag: '', rows: [] },
      { title: 'git', meta: 'https://git.example.com/config', tag: 'main', rows: [] },
    ]);
    expect(rowValue(dom, 'Applications Sync')).toBe('create-update');
    expect(rowValue(dom, 'Preserve on Delete')).toBe('Yes');
    expect(rowValue(dom, 'Strategy')).toBe('RollingSync');
    expect(headings(dom)).toEqual(['Generators', 'Application Management']);
  });
  it('renders AppProject destinations, permissions and sync windows as compact cards', () => {
    const dom = mount({
      ...base,
      kind: 'AppProject',
      status: '',
      statusPresentation: '',
      argoCD: {
        project: {
          destinations: [
            { name: 'prod-eu', server: 'https://prod-eu.example.com', namespace: 'shop' },
            { server: 'https://kubernetes.default.svc', namespace: 'shop-*' },
          ],
          clusterResourceWhitelist: [{ group: '', kind: 'Namespace' }],
          namespaceResourceBlacklist: [
            { group: 'networking.k8s.io', kind: 'NetworkPolicy', name: 'deny' },
          ],
          roles: [{ name: 'reader', groups: ['storefront'], policies: ['p, proj:x, get, allow'] }],
          syncWindows: [
            {
              kind: 'deny',
              schedule: '0 22 * * *',
              duration: '8h',
              timeZone: 'Europe/Berlin',
              manualSync: true,
              andOperator: false,
              applications: ['shop'],
            },
          ],
        },
      },
    });
    expect(cards(section(dom, 'Destinations'))).toEqual([
      { title: 'prod-eu', meta: 'shop', tag: 'https://prod-eu.example.com', rows: [] },
      { title: 'https://kubernetes.default.svc', meta: 'shop-*', tag: '', rows: [] },
    ]);
    expect(cards(section(dom, 'Resource Permissions'))).toEqual([
      { title: 'Cluster Resources', meta: '', tag: '', rows: [['Allowed', 'core/Namespace']] },
      {
        title: 'Namespaced Resources',
        meta: '',
        tag: '',
        rows: [['Denied', 'networking.k8s.io/NetworkPolicy (deny)']],
      },
    ]);
    expect(cards(section(dom, 'Roles'))).toEqual([
      {
        title: 'reader',
        meta: '',
        tag: '',
        rows: [
          ['Groups', 'storefront'],
          ['Policies', 'p, proj:x, get, allow'],
        ],
      },
    ]);
    expect(cards(section(dom, 'Sync Windows'))).toEqual([
      {
        title: 'deny',
        meta: '0 22 * * * · 8h',
        tag: 'Europe/Berlin',
        rows: [
          ['Manual Sync', 'Yes'],
          ['Selector Match', 'Any'],
          ['Applications', 'shop'],
        ],
      },
    ]);
    expect(rowValue(dom, 'Status')).toBeUndefined();
  });
});
