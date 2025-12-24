import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RBACOverview } from './RBACOverview';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

const renderWithProps = async (
  root: ReactDOM.Root,
  props: React.ComponentProps<typeof RBACOverview>
) => {
  await act(async () => {
    root.render(<RBACOverview {...props} />);
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

  it('renders rule details for cluster roles', async () => {
    await renderWithProps(root, {
      kind: 'ClusterRole',
      name: 'admin',
      policyRules: [
        {
          apiGroups: ['', 'apps'],
          resources: ['deployments', 'pods'],
          verbs: ['get', 'list', '*'],
          nonResourceURLs: ['/healthz'],
        },
      ],
    });

    expect(container.textContent).toContain('Rules');
    expect(container.textContent).toContain('deployments');
    expect(container.textContent).toContain('* (all)');
    expect(container.textContent).toContain('/healthz');
  });

  it('renders labels and annotations for roles', async () => {
    await renderWithProps(root, {
      kind: 'Role',
      name: 'reader',
      labels: { team: 'platform' },
      annotations: { owner: 'rbac-admins' },
    });

    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('team:');
    expect(container.textContent).toContain('platform');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('rbac-admins');
  });

  it('renders binding role references and subjects', async () => {
    await renderWithProps(root, {
      kind: 'RoleBinding',
      name: 'bind-reader',
      labels: { env: 'prod' },
      annotations: { managedBy: 'luxury-yacht' },
      roleRef: { kind: 'ClusterRole', name: 'read-only' },
      subjects: [
        { kind: 'ServiceAccount', namespace: 'default', name: 'viewer' },
        { kind: 'User', name: 'alice' },
      ],
    });

    expect(container.textContent).toContain('Role Reference');
    expect(container.textContent).toContain('ClusterRole: read-only');
    expect(container.textContent).toContain('ServiceAccount: default/viewer');
    expect(container.textContent).toContain('User: alice');
    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('env:');
    expect(container.textContent).toContain('prod');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('managedBy:');
    expect(container.textContent).toContain('luxury-yacht');
  });

  it('renders service account specific fields', async () => {
    await renderWithProps(root, {
      kind: 'ServiceAccount',
      name: 'builder',
      labels: { app: 'builder' },
      annotations: { note: 'ci-service' },
      secrets: [{}, {}] as any,
      imagePullSecrets: [{}] as any,
      automountServiceAccountToken: true,
    });

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
