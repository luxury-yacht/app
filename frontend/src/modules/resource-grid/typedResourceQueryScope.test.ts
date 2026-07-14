import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { describe, expect, it } from 'vitest';
import {
  buildTypedResourceQueryScope,
  filterOptionsFromTypedPayload,
  typedResourceQueryIdentity,
  typedResourceQueryLifecycleIdentity,
} from './typedResourceQueryScope';

describe('typedResourceQueryScope', () => {
  it('builds a stable all-namespaces resource query scope', () => {
    const scope = buildTypedResourceQueryScope('cluster-a', {
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        search: 'api',
        kinds: ['Pod', 'Deployment'],
        namespaces: ['zeta', 'apps'],
        queryFacets: {
          statuses: ['Pending', 'Running'],
          nodes: ['node-b', 'node-a'],
        },
      },
      sortConfig: { key: 'cpu', direction: 'desc' },
      pageLimit: 250,
      predicates: { health: 'unhealthy' },
      continueToken: 'cursor-1',
    });

    expect(scope).toBe(
      'cluster-a|namespace:all?limit=250&search=api&namespaces=apps%2Czeta&kinds=Deployment%2CPod&facet.nodes=node-a%2Cnode-b&facet.statuses=Pending%2CRunning&sort=cpu&sortDirection=desc&predicate.health=unhealthy&continue=cursor-1'
    );
  });

  it('serializes Event and Application triage facet selections as provider-owned query keys', () => {
    const scope = buildTypedResourceQueryScope('cluster-a', {
      baseScope: 'namespace:team-a',
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        queryFacets: {
          types: ['Warning'],
          reasons: ['BackOff'],
          sources: ['kubelet'],
          statuses: ['Needs attention'],
          confidences: ['low'],
          hasIssues: ['true'],
        },
      },
      sortConfig: { key: 'name', direction: 'asc' },
      pageLimit: 50,
    });

    expect(scope).toBe(
      'cluster-a|namespace:team-a?limit=50&facet.confidences=low&facet.hasIssues=true&facet.reasons=BackOff&facet.sources=kubelet&facet.statuses=Needs+attention&facet.types=Warning&sort=name&sortDirection=asc'
    );
  });

  it('sends includeMetadata in the scope when metadata search is enabled', () => {
    const scope = buildTypedResourceQueryScope('cluster-a', {
      filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, search: 'team', includeMetadata: true },
      sortConfig: { key: 'name', direction: 'asc' },
      pageLimit: 50,
    });

    expect(scope).toContain('includeMetadata=true');
  });

  it('changes the query identity when metadata search toggles', () => {
    const filters = { ...DEFAULT_GRID_TABLE_FILTER_STATE, search: 'team' };
    const sortConfig = { key: 'name', direction: 'asc' } as const;
    const off = typedResourceQueryIdentity({ filters, sortConfig, predicates: {} });
    const on = typedResourceQueryIdentity({
      filters: { ...filters, includeMetadata: true },
      sortConfig,
      predicates: {},
    });

    expect(off).not.toBe(on);
  });

  it('changes the query identity when a provider-owned facet changes', () => {
    const base = {
      filters: DEFAULT_GRID_TABLE_FILTER_STATE,
      sortConfig: { key: 'name', direction: 'asc' } as const,
      predicates: {},
    };

    expect(
      typedResourceQueryIdentity({
        ...base,
        filters: { ...base.filters, queryFacets: { statuses: ['Running'] } },
      })
    ).not.toBe(
      typedResourceQueryIdentity({
        ...base,
        filters: { ...base.filters, queryFacets: { statuses: ['Pending'] } },
      })
    );
  });

  it('builds the same query identity for equivalent unordered filters', () => {
    const left = typedResourceQueryIdentity({
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        kinds: ['Pod', 'Deployment'],
        namespaces: ['zeta', 'apps'],
        queryFacets: { statuses: ['Running', 'Pending'], nodes: ['node-b', 'node-a'] },
      },
      sortConfig: { key: 'name', direction: 'asc' },
      predicates: { health: 'unhealthy', phase: 'pending' },
    });
    const right = typedResourceQueryIdentity({
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        kinds: ['Deployment', 'Pod'],
        namespaces: ['apps', 'zeta'],
        queryFacets: { nodes: ['node-a', 'node-b'], statuses: ['Pending', 'Running'] },
      },
      sortConfig: { key: 'name', direction: 'asc' },
      predicates: { phase: 'pending', health: 'unhealthy' },
    });

    expect(left).toBe(right);
  });

  it('includes cluster, domain, and page limit in lifecycle identity', () => {
    const base = {
      enabled: true,
      domain: 'pods' as const,
      pageLimit: 250,
      filters: DEFAULT_GRID_TABLE_FILTER_STATE,
      sortConfig: { key: 'name', direction: 'asc' } as const,
    };

    expect(
      typedResourceQueryLifecycleIdentity({
        ...base,
        clusterId: 'cluster-a',
      })
    ).not.toBe(
      typedResourceQueryLifecycleIdentity({
        ...base,
        clusterId: 'cluster-b',
      })
    );
    expect(
      typedResourceQueryLifecycleIdentity({
        ...base,
        clusterId: 'cluster-a',
      })
    ).not.toBe(
      typedResourceQueryLifecycleIdentity({
        ...base,
        clusterId: 'cluster-a',
        pageLimit: 500,
      })
    );
  });

  it('projects advertised status and node facets into query controls', () => {
    expect(
      filterOptionsFromTypedPayload({
        facetValues: [
          {
            key: 'statuses',
            options: [
              { value: 'Pending', label: 'Pending' },
              { value: 'Running', label: 'Running' },
            ],
            exact: true,
          },
          {
            key: 'nodes',
            options: [
              { value: 'node-a', label: 'node-a' },
              { value: 'node-b', label: 'node-b' },
            ],
            exact: true,
          },
        ],
        capabilities: {
          queryFacets: [
            {
              key: 'statuses',
              label: 'Status',
              placeholder: 'All statuses',
              searchable: false,
              bulkActions: true,
            },
            {
              key: 'nodes',
              label: 'Node',
              placeholder: 'All nodes',
              searchable: true,
              bulkActions: true,
            },
          ],
        },
      }).queryFacets
    ).toEqual([
      {
        key: 'statuses',
        label: 'Status',
        placeholder: 'All statuses',
        options: [
          { value: 'Pending', label: 'Pending' },
          { value: 'Running', label: 'Running' },
        ],
        searchable: false,
        bulkActions: true,
      },
      {
        key: 'nodes',
        label: 'Node',
        placeholder: 'All nodes',
        options: [
          { value: 'node-a', label: 'node-a' },
          { value: 'node-b', label: 'node-b' },
        ],
        searchable: true,
        bulkActions: true,
      },
    ]);
  });

  it('projects a new provider facet without shared key-specific metadata', () => {
    expect(
      filterOptionsFromTypedPayload({
        facetValues: [
          {
            key: 'zones',
            options: [{ value: 'us-west-2a', label: 'US West 2A' }],
            exact: false,
          },
        ],
        capabilities: {
          queryFacets: [
            {
              key: 'zones',
              label: 'Zone',
              placeholder: 'All zones',
              searchable: true,
              bulkActions: false,
            },
          ],
        },
      })
    ).toMatchObject({
      queryFacets: [
        {
          key: 'zones',
          label: 'Zone',
          placeholder: 'All zones',
          options: [{ value: 'us-west-2a', label: 'US West 2A' }],
          searchable: true,
          bulkActions: false,
        },
      ],
      partialDataLabel: expect.stringContaining('approximate'),
    });
  });

  it('projects searchable Event triage facets and approximate Application triage facets', () => {
    const options = filterOptionsFromTypedPayload({
      facetValues: [
        {
          key: 'reasons',
          options: [{ value: 'BackOff', label: 'BackOff' }],
          exact: true,
        },
        {
          key: 'sources',
          options: [{ value: 'kubelet', label: 'kubelet' }],
          exact: true,
        },
        {
          key: 'hasIssues',
          options: [
            { value: 'false', label: 'No issues' },
            { value: 'true', label: 'Has issues' },
          ],
          exact: false,
        },
      ],
      facetsExact: false,
      issues: [{ kind: 'Deployment', message: 'list permission denied' }],
      capabilities: {
        queryFacets: [
          {
            key: 'reasons',
            label: 'Reason',
            placeholder: 'All reasons',
            searchable: true,
            bulkActions: true,
          },
          {
            key: 'sources',
            label: 'Source',
            placeholder: 'All sources',
            searchable: true,
            bulkActions: true,
          },
          {
            key: 'hasIssues',
            label: 'Has issues',
            placeholder: 'All issue states',
            searchable: false,
            bulkActions: true,
          },
        ],
      },
    });

    expect(options.queryFacets).toEqual([
      expect.objectContaining({ key: 'reasons', searchable: true }),
      expect.objectContaining({ key: 'sources', searchable: true }),
      expect.objectContaining({
        key: 'hasIssues',
        options: [
          { value: 'false', label: 'No issues' },
          { value: 'true', label: 'Has issues' },
        ],
      }),
    ]);
    expect(options.partialDataLabel).toContain('Deployment: list permission denied');
    expect(options.partialDataLabel).toContain('approximate');
  });
});
