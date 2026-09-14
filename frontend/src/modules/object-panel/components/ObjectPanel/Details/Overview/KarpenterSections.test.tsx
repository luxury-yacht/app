import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { KarpenterCapacity, KarpenterClaimInstance } from './KarpenterSections';

vi.mock('@shared/components/Tooltip', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const mount = (node: ReactNode) => {
  const dom = document.createElement('div');
  dom.innerHTML = renderToStaticMarkup(node);
  return dom;
};

const rows = (dom: HTMLElement) =>
  [...dom.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent)
  );

describe('Karpenter capacity table', () => {
  it('places allocatable and capacity in separate columns per resource', () => {
    const dom = mount(
      <KarpenterCapacity
        facts={{
          capacity: { pods: '58', cpu: '8', memory: '31326296Ki' },
          allocatable: { cpu: '7910m', memory: '29230744Ki', pods: '58' },
        }}
      />
    );
    expect(rows(dom)).toEqual([
      ['Resource', 'Allocatable', 'Capacity'],
      ['cpu', '7910m', '8000m'],
      ['memory', '27.9Gi', '29.9Gi'],
      ['pods', '58', '58'],
    ]);
  });

  it('adds limit and used columns for a pool and flags usage above 80%', () => {
    const dom = mount(
      <KarpenterCapacity
        facts={{
          capacity: { cpu: '900', memory: '256Gi', nodes: '8', pods: '880' },
          limits: { cpu: '1000', memory: '2Ti' },
        }}
      />
    );
    expect(rows(dom)).toEqual([
      ['Resource', 'Capacity', 'Limit', 'Used'],
      ['cpu', '900', '1000', '90%'],
      ['memory', '256.0Gi', '2.0Ti', '12.5%'],
      ['nodes', '8', '-', '-'],
      ['pods', '880', '-', '-'],
    ]);
    const used = [...dom.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('.status-text.warning')?.textContent ?? null
    );
    expect(used).toEqual(['90%', null, null, null]);
  });

  it('drops the allocatable column when the claim has not reported it', () => {
    const dom = mount(<KarpenterCapacity facts={{ capacity: { cpu: '8', memory: '32Gi' } }} />);
    expect(rows(dom)).toEqual([
      ['Resource', 'Capacity'],
      ['cpu', '8'],
      ['memory', '32.0Gi'],
    ]);
  });

  it('renders nothing without capacity data', () => {
    expect(renderToStaticMarkup(<KarpenterCapacity facts={{}} />)).toBe('');
  });
});

describe('Karpenter claim instance', () => {
  it('composes the instance identity and provider identifiers', () => {
    const dom = mount(
      <KarpenterClaimInstance
        facts={{
          instanceType: 'm7g.2xlarge',
          capacityType: 'spot',
          zone: 'us-west-2a',
          architecture: 'arm64',
          providerID: 'aws:///us-west-2a/i-0123',
          imageID: 'ami-0123',
        }}
      />
    );
    const instance = [...dom.querySelectorAll('.overview-item')].find((item) =>
      item.querySelector('.overview-label')?.textContent?.includes('Instance')
    );
    for (const value of ['m7g.2xlarge', 'spot', 'us-west-2a', 'arm64']) {
      expect(instance?.textContent).toContain(value);
    }
    expect(dom.textContent).toContain('aws:///us-west-2a/i-0123');
    expect(dom.textContent).toContain('ami-0123');
  });

  it('renders nothing when the claim has no instance yet', () => {
    expect(renderToStaticMarkup(<KarpenterClaimInstance facts={{}} />)).toBe('');
  });
});
