/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/RBACOverview.test.tsx
 *
 * Behavioral tests for the RBAC Overview descriptors driving the generic OverviewRenderer (X1)
 * inside the real app shell. Each case renders the kind's descriptor against a DTO-shaped fixture
 * and threads cluster identity via the OverviewContext; binding links open panels through the real
 * panel owners. Only the backend boundary is faked (test-utils/appState).
 */

import type {
  clusterrole,
  clusterrolebinding,
  rolebinding,
  serviceaccount,
} from '@core/backend-api/models';
import type React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import {
  clusterRoleBindingDescriptor,
  clusterRoleDescriptor,
  roleBindingDescriptor,
  serviceAccountDescriptor,
} from './descriptors/rbac';
import { OverviewRenderer } from './OverviewRenderer';
import type { OverviewContext, OverviewDescriptor } from './schema';

const app = installAppStateHarness();

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: { kind: string; name: string }) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

describe('RBACOverview', () => {
  let view: MountedApp;
  let dev: TestCluster;
  let container: HTMLElement;

  const renderDescriptor = async <T,>(descriptor: OverviewDescriptor<T>, data: T) => {
    const context: OverviewContext = { clusterId: dev.clusterId, clusterName: dev.clusterName };
    await view.show(<OverviewRenderer descriptor={descriptor} data={data} context={context} />);
  };

  beforeEach(async () => {
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['checkout', 'payments', 'default', 'kube-system']);
    view = await app.render(null);
    container = view.container;
  });

  it('lists every binding that uses a ClusterRole with namespaced bindings told apart', async () => {
    const binding = (kind: string, name: string, namespace?: string) => ({
      clusterId: dev.clusterId,
      group: 'rbac.authorization.k8s.io',
      version: 'v1',
      kind,
      resource: kind === 'RoleBinding' ? 'rolebindings' : 'clusterrolebindings',
      namespace,
      name,
    });
    await renderDescriptor(
      clusterRoleDescriptor,
      partialModelFixture<clusterrole.ClusterRoleDetails>({
        kind: 'ClusterRole',
        name: 'admin',
        clusterRoleBindings: [binding('ClusterRoleBinding', 'platform-admins')],
        roleBindings: [
          binding('RoleBinding', 'admins', 'checkout'),
          binding('RoleBinding', 'admins', 'payments'),
        ],
      })
    );

    const links = [...container.querySelectorAll<HTMLElement>('.object-panel-link')];
    expect(links.map((link) => link.textContent)).toEqual([
      'platform-admins',
      'checkout/admins',
      'payments/admins',
    ]);
    for (const link of links) {
      await act(async () => {
        link.click();
      });
      await app.settle();
    }
    const panel = (kind: string, name: string, namespace = '') => ({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      group: 'rbac.authorization.k8s.io',
      version: 'v1',
      kind,
      namespace,
      name,
    });
    // Same-named bindings in different namespaces open different panels.
    expect(view.openPanels()).toEqual([
      panel('ClusterRoleBinding', 'platform-admins'),
      panel('RoleBinding', 'admins', 'checkout'),
      panel('RoleBinding', 'admins', 'payments'),
    ]);
  });

  it('renders binding role reference and inline subjects list', async () => {
    await renderDescriptor(
      roleBindingDescriptor,
      partialModelFixture<rolebinding.RoleBindingDetails>({
        kind: 'RoleBinding',
        name: 'bind-reader',
        labels: { env: 'prod' },
        annotations: { managedBy: 'luxury-yacht' },
        roleRef: { kind: 'ClusterRole', name: 'read-only' },
        subjects: [
          { kind: 'ServiceAccount', namespace: 'default', name: 'viewer' },
          { kind: 'User', name: 'alice' },
        ],
      })
    );

    expect(container.textContent).toContain('Role Reference');
    expect(container.textContent).toContain('ClusterRole/read-only');
    expect(container.textContent).toContain('Subjects');
    expect(container.textContent).toContain('ServiceAccount');
    expect(container.textContent).toContain('default/viewer');
    expect(container.textContent).toContain('User');
    expect(container.textContent).toContain('alice');
    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('env:');
    expect(container.textContent).toContain('prod');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('managedBy:');
    expect(container.textContent).toContain('luxury-yacht');
  });

  it('flags ServiceAccount subjects in system namespaces with a warning chip', async () => {
    await renderDescriptor(
      clusterRoleBindingDescriptor,
      partialModelFixture<clusterrolebinding.ClusterRoleBindingDetails>({
        kind: 'ClusterRoleBinding',
        name: 'bind-system',
        roleRef: { kind: 'ClusterRole', name: 'cluster-admin' },
        subjects: [{ kind: 'ServiceAccount', namespace: 'kube-system', name: 'controller' }],
      })
    );

    const warningChip = Array.from(
      container.querySelectorAll<HTMLElement>('.status-chip--warning')
    ).find((el) => el.textContent?.trim() === 'system');
    expect(warningChip).toBeTruthy();
  });

  it('renders service account specific fields', async () => {
    await renderDescriptor(
      serviceAccountDescriptor,
      partialModelFixture<serviceaccount.ServiceAccountDetails>({
        kind: 'ServiceAccount',
        name: 'builder',
        labels: { app: 'builder' },
        annotations: { note: 'ci-service' },
        secrets: [{}, {}],
        imagePullSecrets: [{}],
        automountServiceAccountToken: true,
      })
    );

    expect(container.textContent).toContain('Secrets');
    expect(container.textContent).toContain('2 secret(s)');
    expect(container.textContent).toContain('Image Pull Secrets');
    expect(container.textContent).toContain('1 secret(s)');
    expect(container.textContent).toContain('Automount Token');
    expect(container.textContent).toContain('Yes');
    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('app:');
    expect(container.textContent).toContain('builder');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('note:');
    expect(container.textContent).toContain('ci-service');
  });
});
