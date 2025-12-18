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

  it('renders binding role references and subjects', async () => {
    await renderWithProps(root, {
      kind: 'RoleBinding',
      name: 'bind-reader',
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
  });

  it('renders service account specific fields', async () => {
    await renderWithProps(root, {
      kind: 'ServiceAccount',
      name: 'builder',
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
  });
});
