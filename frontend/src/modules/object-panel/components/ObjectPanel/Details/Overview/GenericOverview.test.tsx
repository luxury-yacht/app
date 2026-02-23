/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/GenericOverview.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GenericOverview } from './GenericOverview';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

describe('GenericOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof GenericOverview>) => {
    await act(async () => {
      root.render(<GenericOverview {...props} />);
      await Promise.resolve();
    });
  };

  const getValueForLabel = (label: string) => {
    const labelElement = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
      (el) => el.textContent?.trim() === label
    );
    const valueElement = labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value');
    if (!valueElement) {
      throw new Error(`Value element for label "${label}" not found`);
    }
    return valueElement;
  };

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

  it('renders representative fields for multiple resource shapes', async () => {
    await renderComponent({
      kind: 'Service',
      name: 'api',
      namespace: 'default',
      age: '3d',
      type: 'ClusterIP',
      clusterIP: '10.0.0.10',
      externalIPs: ['1.1.1.1', '2.2.2.2'],
      ports: [
        { name: 'http', port: 80, protocol: 'TCP', targetPort: 8080 },
        { port: 443, protocol: 'TCP' },
      ],
      sessionAffinity: 'ClientIP',
      ingressClassName: 'nginx',
      rules: [{}, {}],
      tls: [{}],
      loadBalancerStatus: ['alp-1'],
      podSelector: { app: 'api' },
      policyTypes: ['Ingress', 'Egress'],
      ingressRules: [{}],
      egressRules: [{}, {}],
      totalAddresses: 5,
      totalNotReady: 1,
      totalPorts: 3,
      secrets: [{}, {}],
      imagePullSecrets: [{}],
      automountServiceAccountToken: true,
      roleBindings: [{}],
      clusterRoleBindings: [{}],
      roleRef: { kind: 'ClusterRole', name: 'admin' },
      subjects: [{ kind: 'ServiceAccount', namespace: 'default', name: 'api-sa' }],
    });

    expect(getValueForLabel('Type').textContent).toBe('ClusterIP');
    expect(getValueForLabel('Cluster IP').textContent).toBe('10.0.0.10');
    expect(getValueForLabel('External IPs').textContent).toBe('1.1.1.1, 2.2.2.2');
    const portsValue = getValueForLabel('Ports');
    expect(portsValue.textContent).toContain('http: 80/TCP → 8080');
    expect(portsValue.textContent).toContain('443/TCP');
    expect(getValueForLabel('Session Affinity').textContent).toBe('ClientIP');
    expect(getValueForLabel('Ingress Class').textContent).toBe('nginx');
    expect(getValueForLabel('Rules').textContent).toBe('2 rule(s)');
    expect(getValueForLabel('TLS').textContent).toBe('Enabled');
    expect(getValueForLabel('Load Balancer').textContent).toBe('alp-1');
    expect(getValueForLabel('Pod Selector').textContent).toBe('app=api');
    expect(getValueForLabel('Policy Types').textContent).toBe('Ingress, Egress');
    expect(getValueForLabel('Ingress Rules').textContent).toBe('1 rule(s)');
    expect(getValueForLabel('Egress Rules').textContent).toBe('2 rule(s)');
    expect(getValueForLabel('Total Addresses').textContent).toBe('5');
    expect(getValueForLabel('Not Ready').textContent).toBe('1');
    expect(getValueForLabel('Total Ports').textContent).toBe('3');
    expect(getValueForLabel('Secrets').textContent).toBe('2 secret(s)');
    expect(getValueForLabel('Image Pull Secrets').textContent).toBe('1 secret(s)');
    expect(getValueForLabel('Automount Token').textContent).toBe('Yes');
    expect(getValueForLabel('Role Bindings').textContent).toBe('1 binding(s)');
    expect(getValueForLabel('Cluster Role Bindings').textContent).toBe('1 binding(s)');
    expect(getValueForLabel('Role Reference').textContent).toBe('ClusterRole/admin');
    expect(getValueForLabel('Subjects').textContent).toContain('ServiceAccount: default/api-sa');
  });

  it('renders labels and annotations when provided', async () => {
    await renderComponent({
      kind: 'Widget',
      name: 'gizmo',
      labels: { env: 'prod' },
      annotations: { owner: 'custom-team' },
    });

    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('env:');
    expect(container.textContent).toContain('prod');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('custom-team');
  });
});
