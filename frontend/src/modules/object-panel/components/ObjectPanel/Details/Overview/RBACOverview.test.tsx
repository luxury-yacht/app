/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/RBACOverview.test.tsx
 *
 * Behavioral tests for the RBAC Overview descriptors driving the generic OverviewRenderer (X1).
 * Each case renders the kind's descriptor against a DTO-shaped fixture and threads cluster identity
 * via the OverviewContext.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clusterrole,
  clusterrolebinding,
  role,
  rolebinding,
  serviceaccount,
} from '@wailsjs/go/models';
import { OverviewRenderer } from './OverviewRenderer';
import {
  clusterRoleBindingDescriptor,
  clusterRoleDescriptor,
  roleBindingDescriptor,
  roleDescriptor,
  serviceAccountDescriptor,
} from './descriptors/rbac';
import type { OverviewContext, OverviewDescriptor } from './schema';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    objectData: { clusterId: 'test-cluster', clusterName: 'test' },
  }),
}));

vi.mock('@shared/components/ObjectPanelLink', () => ({
  ObjectPanelLink: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>,
}));

const context: OverviewContext = { clusterId: 'test-cluster', clusterName: 'test' };

const renderDescriptor = async <T,>(
  root: ReactDOM.Root,
  descriptor: OverviewDescriptor<T>,
  data: T
) => {
  await act(async () => {
    root.render(<OverviewRenderer descriptor={descriptor} data={data} context={context} />);
    await Promise.resolve();
  });
};

describe('RBACOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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

  it('renders metadata and aggregation/used-by sections for cluster roles', async () => {
    await renderDescriptor(
      root,
      clusterRoleDescriptor,
      clusterrole.ClusterRoleDetails.createFrom({
        kind: 'ClusterRole',
        name: 'admin',
        labels: { team: 'platform' },
        annotations: { owner: 'rbac-admins' },
        // Rules render in DetailsTabRBACRules now (a sibling section);
        // the descriptor only handles header/aggregation/used-by/metadata.
      })
    );

    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('team:');
    expect(container.textContent).toContain('platform');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('rbac-admins');
  });

  it('renders labels and annotations for roles', async () => {
    await renderDescriptor(
      root,
      roleDescriptor,
      role.RoleDetails.createFrom({
        kind: 'Role',
        name: 'reader',
        labels: { team: 'platform' },
        annotations: { owner: 'rbac-admins' },
      })
    );

    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('team:');
    expect(container.textContent).toContain('platform');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('rbac-admins');
  });

  it('renders binding role reference and inline subjects list', async () => {
    await renderDescriptor(
      root,
      roleBindingDescriptor,
      rolebinding.RoleBindingDetails.createFrom({
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
      root,
      clusterRoleBindingDescriptor,
      clusterrolebinding.ClusterRoleBindingDetails.createFrom({
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

  it('renders cluster role binding metadata', async () => {
    await renderDescriptor(
      root,
      clusterRoleBindingDescriptor,
      clusterrolebinding.ClusterRoleBindingDetails.createFrom({
        kind: 'ClusterRoleBinding',
        name: 'bind-admin',
        labels: { env: 'prod' },
        annotations: { owner: 'security' },
        roleRef: { kind: 'ClusterRole', name: 'admin' },
      })
    );

    expect(container.textContent).toContain('Role Reference');
    expect(container.textContent).toContain('ClusterRole/admin');
    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('env:');
    expect(container.textContent).toContain('prod');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('security');
  });

  it('renders service account specific fields', async () => {
    await renderDescriptor(
      root,
      serviceAccountDescriptor,
      serviceaccount.ServiceAccountDetails.createFrom({
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
