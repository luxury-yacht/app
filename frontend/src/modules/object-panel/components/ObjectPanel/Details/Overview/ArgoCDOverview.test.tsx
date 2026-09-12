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
describe('Argo CD overview', () => {
  it('shows independent sync and health, multiple sources, disabled automation and the namespaced owner', () => {
    const html = render({
      ...base,
      argoCD: {
        application: {
          spec: {
            project: 'production',
            destination: { name: 'remote-prod', namespace: 'store' },
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
});
