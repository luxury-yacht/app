import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CustomResourceDetails } from '@/core/refresh/types';
import { getOverviewDescriptor } from './descriptorRegistry';
import { OverviewRenderer } from './OverviewRenderer';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: ({ kind, name }: { kind: string; name: string }) => (
    <span>
      {kind} {name}
    </span>
  ),
}));
vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({ ResourceMetadata: () => null }));
vi.mock('@shared/components/Tooltip', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@shared/components/ObjectPanelLink', () => ({
  ObjectPanelLink: ({ objectRef }: { objectRef: { name: string } }) => (
    <button type="button">{objectRef.name}</button>
  ),
}));

const detail: CustomResourceDetails = {
  ref: { clusterId: 'a', group: 'karpenter.sh', version: 'v1', kind: 'NodePool', name: 'default' },
  kind: 'NodePool',
  name: 'default',
  resourceFamily: 'karpenter',
  status: 'Ready',
  statusState: 'true',
  statusPresentation: 'ready',
  karpenter: {
    weight: 0,
    replicas: 0,
    limits: { cpu: '1000' },
    consolidationPolicy: 'WhenEmptyOrUnderutilized',
    expireAfter: '720h',
    requirements: [{ key: 'kubernetes.io/arch', operator: 'In', values: ['arm64'] }],
  },
  conditions: [
    {
      type: 'Ready',
      status: 'True',
      reason: 'Ready',
      message: 'All dependencies ready',
      lastTransitionTime: null,
    },
  ],
};

function requireDescriptor(kind: string, data: CustomResourceDetails) {
  const descriptor = getOverviewDescriptor(kind, data);
  if (!descriptor) {
    throw new Error('Karpenter descriptor missing');
  }
  return descriptor;
}

describe('Karpenter overview', () => {
  it('groups pool configuration into readable sections and separate requirement rows', () => {
    const data = {
      ...detail,
      karpenter: {
        ...detail.karpenter,
        capacity: { cpu: '8', memory: '32Gi' },
        requirements: [
          { key: 'kubernetes.io/arch', operator: 'In', values: ['arm64'] },
          { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['spot', 'on-demand'] },
        ],
      },
    };
    const descriptor = requireDescriptor('NodePool', data);
    const html = renderToStaticMarkup(
      <OverviewRenderer descriptor={descriptor} data={data as never} />
    );
    const dom = document.createElement('div');
    dom.innerHTML = html;
    expect([...dom.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
      'Capacity',
      'Scheduling',
      'Disruption',
      'Lifecycle',
      'Conditions',
    ]);
    expect(dom.querySelectorAll('[aria-label="Requirements"] .overview-row')).toHaveLength(2);
    expect(html).not.toContain('cpu: 8, memory: 32Gi');
  });
  it('omits empty sections for a newly created object', () => {
    const data = { ...detail, karpenter: {}, conditions: [] };
    const descriptor = requireDescriptor('NodePool', data);
    const html = renderToStaticMarkup(
      <OverviewRenderer descriptor={descriptor} data={data as never} />
    );
    expect(html).not.toContain('<h3');
  });
  it('renders backend resource fields including zero values and controller conditions', () => {
    const descriptor = getOverviewDescriptor('nodepool', detail);
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error('Karpenter descriptor missing');
    }
    const html = renderToStaticMarkup(
      <OverviewRenderer descriptor={descriptor} data={detail as never} />
    );
    for (const value of [
      'NodePool',
      'default',
      'Weight',
      'Replicas',
      '1000',
      'WhenEmptyOrUnderutilized',
      '720h',
      'arm64',
    ]) {
      expect(html).toContain(value);
    }
  });
  it('renders claim relationships and constraints without unrelated provider-class configuration', () => {
    const claim: CustomResourceDetails = {
      ...detail,
      kind: 'NodeClaim',
      karpenter: {
        nodePool: {
          ref: {
            clusterId: 'a',
            group: 'karpenter.sh',
            version: 'v1beta1',
            kind: 'NodePool',
            name: 'linked-pool',
          },
        },
        nodeClass: { display: { clusterId: 'a', kind: 'EC2NodeClass', name: 'display-class' } },
        capacity: { cpu: '4', memory: '16Gi' },
        allocatable: { cpu: '3920m' },
        instanceType: 'm7g.xlarge',
        capacityType: 'spot',
        zone: 'us-east-1a',
        taints: [{ key: 'dedicated', value: 'batch', effect: 'NoSchedule' }],
        startupTaints: [{ key: 'initializing', effect: 'NoExecute' }],
        budgets: [
          { nodes: '10%', reasons: ['Underutilized'], schedule: '0 9 * * *', duration: '1h' },
        ],
        subnets: ['subnet-123'],
        securityGroups: ['sg-123'],
        images: ['ami-123'],
        tags: { team: 'platform' },
      },
    };
    const descriptor = getOverviewDescriptor('NodeClaim', claim);
    if (!descriptor) {
      throw new Error('Karpenter descriptor missing');
    }
    const html = renderToStaticMarkup(
      <OverviewRenderer descriptor={descriptor} data={claim as never} />
    );
    for (const value of [
      'linked-pool',
      'display-class',
      '3920m',
      'm7g.xlarge',
      'spot',
      'dedicated',
      'batch',
      'NoSchedule',
      'initializing',
      'NoExecute',
    ]) {
      expect(html).toContain(value);
    }
    expect(html).not.toContain('subnet-123');
    expect(html).not.toContain('Disruption');
    expect(html).toContain('<button type="button">linked-pool</button>');
    expect(html).not.toContain('<button type="button">display-class</button>');
  });
  it('gives provider resolution its own sections without flattening lists', () => {
    const data: CustomResourceDetails = {
      ...detail,
      kind: 'EC2NodeClass',
      karpenter: {
        imageFamily: 'AL2023',
        role: 'karpenter-node-role',
        subnets: ['subnet-one', 'subnet-two'],
        securityGroups: ['sg-one'],
        images: ['ami-one', 'ami-two'],
        tags: { team: 'platform' },
      },
    };
    const descriptor = requireDescriptor('EC2NodeClass', data);
    const dom = document.createElement('div');
    dom.innerHTML = renderToStaticMarkup(
      <OverviewRenderer descriptor={descriptor} data={data as never} />
    );
    expect([...dom.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual([
      'Networking',
      'Images',
      'Tags',
      'Conditions',
    ]);
    expect(dom.querySelectorAll('[aria-label="Subnets"] .overview-ref-item')).toHaveLength(2);
    expect(dom.querySelectorAll('[aria-label="Images"] .overview-ref-item')).toHaveLength(2);
    expect(dom.textContent).toContain('platform');
    expect(dom.textContent).not.toContain('Consolidation');
  });
  it('renders budgets as distinct records, lifecycle and overlay zero values', () => {
    const data: CustomResourceDetails = {
      ...detail,
      karpenter: {
        ...detail.karpenter,
        consolidateAfter: '30s',
        terminationGracePeriod: '48h',
        budgets: [
          { nodes: '10%', reasons: ['Underutilized'], schedule: '0 9 * * *', duration: '1h' },
          { nodes: '0' },
        ],
        startupTaints: [{ key: 'initializing', effect: 'NoSchedule' }],
      },
    };
    const descriptor = requireDescriptor('NodePool', data);
    const dom = document.createElement('div');
    dom.innerHTML = renderToStaticMarkup(
      <OverviewRenderer descriptor={descriptor} data={data as never} />
    );
    expect(dom.querySelectorAll('.karpenter-budget')).toHaveLength(2);
    for (const value of ['30s', '48h', '10%', 'Underutilized', '0 9 * * *', '1h']) {
      expect(dom.textContent).toContain(value);
    }
    const overlay = {
      ...data,
      kind: 'NodeOverlay',
      karpenter: {
        weight: 0,
        priceAdjustment: '-10%',
        requirements: [{ key: 'instance-type', operator: 'Exists', minValues: 0 }],
      },
    };
    dom.innerHTML = renderToStaticMarkup(
      <OverviewRenderer descriptor={descriptor} data={overlay as never} />
    );
    expect(dom.textContent).toContain('Weight0');
    expect(dom.textContent).toContain('-10%');
    expect(dom.textContent).toContain('min values: 0');
  });
  it('keeps colliding unknown kinds on the generic overview', () => {
    expect(getOverviewDescriptor('NodePool', { ...detail, resourceFamily: '' })).toBeUndefined();
  });
});
