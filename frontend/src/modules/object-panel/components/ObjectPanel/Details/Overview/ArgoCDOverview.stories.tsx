import { CurrentObjectPanelContext } from '@modules/object-panel/hooks/useObjectPanel';
import type { Meta, StoryObj } from '@storybook/react';
import type { CustomResourceDetails } from '@/core/refresh/types';
import { SidebarProvidersDecorator } from '../../../../../../../.storybook/decorators/SidebarProvidersDecorator';
import { getOverviewDescriptor } from './descriptorRegistry';
import { OverviewRenderer } from './OverviewRenderer';
import '../DetailsTab.css';
import '../../shared.css';
import '@/App.css';

function ArgoCDOverviewPreview({ detail }: Readonly<{ detail: CustomResourceDetails }>) {
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
    group: 'argoproj.io',
    version: 'v1alpha1',
    kind: 'Application',
    namespace: 'argocd',
    name: 'shop',
  },
  kind: 'Application',
  name: 'shop',
  resourceFamily: 'argocd',
  status: 'Healthy',
  statusState: 'Healthy',
  statusPresentation: 'ready',
  labels: { 'app.kubernetes.io/instance': 'shop', team: 'storefront' },
};

const application: CustomResourceDetails = {
  ...base,
  argoCD: {
    application: {
      spec: {
        project: 'production',
        destination: {
          server: 'https://prod-eu.example.com',
          resolvedName: 'prod-eu',
          namespace: 'shop',
        },
        sources: [
          {
            repoURL: 'https://git.example.com/platform/deploy-config.git',
            path: 'apps/shop/overlays/prod',
            targetRevision: 'main',
          },
          {
            repoURL: 'https://charts.example.com/storefront',
            chart: 'shop',
            targetRevision: '2.14.0',
          },
          { repoURL: 'https://git.example.com/platform/values.git', ref: 'values' },
        ],
        syncPolicy: {
          automated: { prune: true, selfHeal: true, allowEmpty: false },
          syncOptions: ['CreateNamespace=true', 'PruneLast=true', 'ServerSideApply=true'],
        },
      },
      sync: 'Synced',
      syncPresentation: 'ready',
      health: 'Healthy',
      healthPresentation: 'ready',
      revisions: ['9f3c2a1d7b8e4f5a6c9d0e1f2a3b4c5d6e7f8a9b', '2.14.0', 'a1b2c3d'],
      resourceCount: 27,
      operation: {
        phase: 'Succeeded',
        phasePresentation: 'ready',
        message: 'successfully synced (all tasks run)',
        startedAt: '2026-09-13T18:42:10Z',
        finishedAt: '2026-09-13T18:42:31Z',
      },
      applicationSet: {
        ref: { ...base.ref, kind: 'ApplicationSet', name: 'storefront-apps' },
      },
    },
  },
};

const meta: Meta<typeof ArgoCDOverviewPreview> = {
  title: 'Object Panel/Argo CD Overview',
  component: ArgoCDOverviewPreview,
  decorators: [SidebarProvidersDecorator],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof ArgoCDOverviewPreview>;

export const Application: Story = { args: { detail: application } };
export const ApplicationDegraded: Story = {
  args: {
    detail: {
      ...application,
      status: 'Degraded',
      statusState: 'Degraded',
      statusPresentation: 'error',
      argoCD: {
        application: {
          ...application.argoCD?.application,
          spec: {
            project: 'production',
            destination: { server: 'https://kubernetes.default.svc', namespace: 'shop' },
            source: {
              repoURL: 'https://git.example.com/platform/deploy-config.git',
              path: 'apps/shop/overlays/prod',
              targetRevision: 'release-2026.09',
            },
            syncPolicy: {
              automated: { enabled: false, prune: true, selfHeal: false, allowEmpty: false },
            },
          },
          sync: 'OutOfSync',
          syncPresentation: 'warning',
          health: 'Degraded',
          healthPresentation: 'error',
          healthMessage:
            'Deployment "shop-api" has 0/3 available replicas; container "api" is in CrashLoopBackOff',
          revisions: ['c0ffee12'],
          resourceCount: 27,
          operation: {
            phase: 'Failed',
            phasePresentation: 'error',
            message:
              'one or more objects failed to apply, reason: Deployment.apps "shop-api" is invalid: spec.template.spec.containers[0].image: Required value',
            startedAt: '2026-09-14T09:05:00Z',
            finishedAt: '2026-09-14T09:05:04Z',
          },
          applicationSet: undefined,
        },
        conditions: [
          {
            type: 'SyncError',
            presentation: 'error',
            message: 'Failed sync attempt to c0ffee12: one or more objects failed to apply',
          },
          {
            type: 'SharedResourceWarning',
            presentation: 'warning',
            message: 'ConfigMap/shop-config is part of applications shop and shop-canary',
          },
        ],
      },
    },
  },
};
export const ApplicationSet: Story = {
  args: {
    detail: {
      ...base,
      kind: 'ApplicationSet',
      name: 'storefront-apps',
      ref: { ...base.ref, kind: 'ApplicationSet', name: 'storefront-apps' },
      argoCD: {
        applicationSet: {
          templateName: '{{.cluster.name}}-shop',
          goTemplate: true,
          template: {
            project: 'production',
            destination: { name: '{{.cluster.name}}', namespace: 'shop' },
            source: {
              repoURL: 'https://git.example.com/platform/deploy-config.git',
              path: 'apps/shop/overlays/{{.cluster.env}}',
              targetRevision: 'main',
            },
            syncPolicy: { automated: { prune: true, selfHeal: true, allowEmpty: false } },
          },
          generators: [
            { type: 'matrix' },
            { type: 'clusters' },
            {
              type: 'git',
              repoURL: 'https://git.example.com/platform/deploy-config.git',
              revision: 'main',
            },
          ],
          strategy: 'RollingSync',
          applicationsSync: 'create-update',
          preserveResourcesOnDeletion: true,
        },
        conditions: [
          { type: 'ErrorOccurred', status: 'False', presentation: 'ready' },
          { type: 'ParametersGenerated', status: 'True', presentation: 'ready' },
          { type: 'ResourcesUpToDate', status: 'True', presentation: 'ready' },
        ],
      },
    },
  },
};
export const AppProject: Story = {
  args: {
    detail: {
      ...base,
      kind: 'AppProject',
      name: 'production',
      ref: { ...base.ref, kind: 'AppProject', name: 'production' },
      status: '',
      statusState: '',
      statusPresentation: '',
      argoCD: {
        project: {
          description: 'Production storefront workloads. Changes require a release ticket.',
          sourceRepos: ['https://git.example.com/platform/*', 'https://charts.example.com/*'],
          sourceNamespaces: ['storefront-*'],
          destinations: [
            { name: 'prod-eu', server: 'https://prod-eu.example.com', namespace: 'shop' },
            { name: 'prod-us', server: 'https://prod-us.example.com', namespace: 'shop' },
            { server: 'https://kubernetes.default.svc', namespace: 'shop-*' },
          ],
          clusterResourceWhitelist: [{ group: '', kind: 'Namespace' }],
          namespaceResourceBlacklist: [
            { group: '', kind: 'ResourceQuota' },
            { group: 'networking.k8s.io', kind: 'NetworkPolicy', name: 'default-deny' },
          ],
          roles: [
            {
              name: 'release-manager',
              description: 'May sync production applications during release windows.',
              groups: ['storefront-release', 'platform-oncall'],
              policies: [
                'p, proj:production:release-manager, applications, sync, production/*, allow',
                'p, proj:production:release-manager, applications, get, production/*, allow',
              ],
            },
            {
              name: 'reader',
              groups: ['storefront'],
              policies: ['p, proj:production:reader, applications, get, production/*, allow'],
            },
          ],
          syncWindows: [
            {
              kind: 'deny',
              schedule: '0 22 * * *',
              duration: '8h',
              timeZone: 'Europe/Berlin',
              manualSync: true,
              andOperator: false,
              applications: ['shop', 'shop-canary'],
              clusters: ['prod-eu', 'prod-us'],
            },
            {
              kind: 'allow',
              schedule: '0 9 * * mon-fri',
              duration: '10h',
              manualSync: false,
              andOperator: true,
              namespaces: ['shop-*'],
            },
          ],
        },
      },
    },
  },
};
