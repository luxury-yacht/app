import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useAvailableClusterViews, useAvailableNamespaceViews } from './useAvailableResourceViews';

const state = vi.hoisted(() => ({
  data: {
    clusterId: 'a',
    resourceFamilies: { cluster: ['cert-manager'], namespaced: ['external-secrets', 'prometheus'] },
  },
}));
vi.mock('@core/data-access', () => ({ useRefreshDomainHandle: () => ({ data: state.data }) }));
vi.mock('@core/refresh/hooks/useStreamSignalRefetch', () => ({ useStreamSignalRefetch: vi.fn() }));

describe('discovered resource view availability', () => {
  it('uses discovered scope and drops retained availability when switching clusters', () => {
    const result = { current: { cluster: [] as string[], namespaced: [] as string[] } };
    function Probe({ clusterId }: { clusterId: string }) {
      result.current = {
        cluster: useAvailableClusterViews(clusterId).map((view) => view.id),
        namespaced: useAvailableNamespaceViews(clusterId).map((view) => view.id),
      };
      return null;
    }
    const rerender = ({ clusterId }: { clusterId: string }) =>
      renderToStaticMarkup(<Probe clusterId={clusterId} />);
    rerender({ clusterId: 'a' });
    expect(result.current.cluster).toContain('cert-manager');
    expect(result.current.cluster).not.toContain('external-secrets');
    expect(result.current.namespaced).not.toContain('cert-manager');
    expect(result.current.namespaced).toEqual(
      expect.arrayContaining(['external-secrets', 'prometheus'])
    );
    rerender({ clusterId: 'b' });
    expect(result.current.cluster).not.toContain('cert-manager');
    expect(result.current.namespaced).not.toContain('prometheus');
    state.data = { clusterId: 'b', resourceFamilies: { cluster: [], namespaced: [] } };
    rerender({ clusterId: 'b' });
    expect(result.current.namespaced).not.toContain('external-secrets');
  });
});
