import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { getViewForKind } from '@/utils/kindViewMap';
import { normalizeHydratedCustomRow } from '../hooks/customCatalogRowAdapter';
import { operatorColumns } from './operatorColumns';

describe('operator table relationships', () => {
  it('keeps discovered target identity through hydration, click, and family navigation', async () => {
    const issuer = {
      clusterId: 'target-cluster',
      group: 'cert-manager.io',
      version: 'v1beta1',
      kind: 'ClusterIssuer',
      resource: 'clusterissuers',
      name: 'public',
    };
    const row = normalizeHydratedCustomRow({
      ref: {
        clusterId: 'source-cluster',
        group: 'cert-manager.io',
        version: 'v1',
        kind: 'Certificate',
        resource: 'certificates',
        namespace: 'team-a',
        name: 'tls',
      },
      certManager: { issuer: { ref: issuer } },
    });
    const openReference = vi.fn();
    const navigateReference = vi.fn();
    const column = operatorColumns('cert-manager', {
      baseColumns: [],
      openReference,
      navigateReference,
      selectedClusterName: 'Source',
    }).find((candidate) => candidate.key === 'issuer');
    expect(column).toBeDefined();
    const dom = document.createElement('div');
    const root = createRoot(dom);
    try {
      await act(async () => root.render(column?.render(row)));
      const button = dom.querySelector('button');
      expect(button).not.toBeNull();
      await act(async () => button?.click());
      expect(openReference).toHaveBeenLastCalledWith(expect.objectContaining(issuer));
      await act(async () =>
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))
      );
      expect(navigateReference).toHaveBeenLastCalledWith(expect.objectContaining(issuer));
      expect(getViewForKind(issuer.kind, issuer.group, '')).toEqual({
        viewType: 'cluster',
        tab: 'cert-manager',
      });
      expect(getViewForKind('Certificate', 'cert-manager.io', 'team-a')).toEqual({
        viewType: 'namespace',
        tab: 'cert-manager',
      });
      expect(getViewForKind('Certificate', 'other.io', 'team-a')).toBeNull();
      await act(async () =>
        root.render(
          column?.render({
            ...row,
            certManager: { issuer: { display: { ...issuer, version: '' } } },
          })
        )
      );
      expect(dom.querySelector('button')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('retains zero counts and template target names from hydrated family data', () => {
    const row = normalizeHydratedCustomRow({
      ref: {
        clusterId: 'a',
        group: 'monitoring.coreos.com',
        version: 'v1',
        kind: 'Prometheus',
        resource: 'prometheuses',
        namespace: 'team-a',
        name: 'metrics',
      },
      prometheus: { replicas: 0, endpoints: 0, rules: 0 },
    });
    expect(row.prometheus).toEqual({ replicas: 0, endpoints: 0, rules: 0 });
    const template = normalizeHydratedCustomRow({
      ref: {
        clusterId: 'a',
        group: 'external-secrets.io',
        version: 'v1',
        kind: 'ClusterExternalSecret',
        resource: 'clusterexternalsecrets',
        name: 'distribution',
      },
      externalSecrets: { storeName: 'vault', targetName: 'database' },
    });
    expect(template.externalSecrets).toEqual({ storeName: 'vault', targetName: 'database' });
    expect(getViewForKind('ClusterExternalSecret', 'external-secrets.io', '')).toEqual({
      viewType: 'cluster',
      tab: 'external-secrets',
    });
    expect(getViewForKind('ServiceMonitor', 'monitoring.coreos.com', 'team-a')).toEqual({
      viewType: 'namespace',
      tab: 'prometheus',
    });
  });
});
