import type { CustomResourceGridRow } from '@modules/browse/components/CustomResourceGridView';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { karpenterColumns } from './karpenterColumns';

const source: CustomResourceGridRow = {
  ref: {
    clusterId: 'a',
    group: 'karpenter.sh',
    version: 'v1',
    kind: 'NodeClaim',
    resource: 'nodeclaims',
    name: 'claim',
  },
  karpenter: {
    nodePool: {
      ref: {
        clusterId: 'b',
        group: 'karpenter.sh',
        version: 'v1beta1',
        kind: 'NodePool',
        name: 'pool',
      },
    },
    nodeClass: {
      ref: {
        clusterId: 'a',
        group: 'karpenter.k8s.aws',
        version: 'v1beta1',
        kind: 'EC2NodeClass',
        resource: 'ec2nodeclasses',
        name: 'class',
      },
    },
    instanceType: 'm7g.large',
    capacityType: 'spot',
  },
};

describe('Karpenter columns', () => {
  const parts = {
    baseColumns: [{ key: 'crd', header: 'CRD', render: () => '-' }],
    openReference: vi.fn(),
    navigateReference: vi.fn(),
    selectedClusterName: 'Cluster',
  };
  it('renders one field per cell and exports only that value', () => {
    const columns = karpenterColumns(parts);
    const dom = document.createElement('div');
    for (const [index, value] of ['-', 'pool', 'class', 'm7g.large'].entries()) {
      const column = columns[index];
      dom.innerHTML = renderToStaticMarkup(column.render(source));
      expect(dom.textContent).toBe(value);
      expect(
        dom
          .querySelector('[data-gridtable-export-text]')
          ?.getAttribute('data-gridtable-export-text') ?? dom.textContent
      ).toBe(value);
      expect(column.sortable).toBe(false);
    }
    expect(dom.textContent).not.toContain('Configuration');
  });
  it('calculates NodePool usage against limits without treating unavailable percentages as zero', () => {
    const column = karpenterColumns(parts).find((entry) => entry.key === 'usage');
    expect(column).toBeDefined();
    const pool = { ...source, ref: { ...source.ref, kind: 'NodePool', resource: 'nodepools' } };
    const dom = document.createElement('div');
    for (const [capacity, limits, expected] of [
      [{ cpu: '1250m', memory: '768Gi' }, { cpu: '2', memory: '1Ti' }, 'CPU 62.5% / Mem 75%'],
      [{ cpu: '8', memory: '0' }, { cpu: '10', memory: '1Ti' }, 'CPU 80% / Mem 0%'],
      [{ cpu: '8500m', memory: '1.2Ti' }, { cpu: '10', memory: '1Ti' }, 'CPU 85% / Mem 120%'],
      [{ cpu: '1', memory: '2Gi' }, { cpu: '0' }, '-'],
      [{ memory: '1Gi' }, { cpu: '10', memory: '2Gi' }, 'CPU - / Mem 50%'],
    ] as const) {
      dom.innerHTML = renderToStaticMarkup(
        column?.render({ ...pool, karpenter: { capacity, limits } })
      );
      expect(dom.textContent).toBe(expected);
      expect(
        dom
          .querySelector('[data-gridtable-export-text]')
          ?.getAttribute('data-gridtable-export-text') ?? dom.textContent
      ).toBe(expected);
    }
    expect(column?.render(source)).toBe('-');
    expect(
      column?.render({
        ...source,
        ref: { ...source.ref, kind: 'EC2NodeClass', resource: 'ec2nodeclasses' },
      })
    ).toBe('-');
  });
  it('preserves full linked identity for click and alt-click and leaves incomplete references as text', async () => {
    const columns = karpenterColumns(parts);
    const referenceColumns = columns.filter(
      (column) => column.key === 'nodePool' || column.key === 'nodeClass'
    );
    const dom = document.createElement('div');
    const root = createRoot(dom);
    for (const [index, link] of [
      source.karpenter?.nodePool,
      source.karpenter?.nodeClass,
    ].entries()) {
      await act(async () => {
        root.render(referenceColumns[index].render(source));
      });
      const button = dom.querySelector('button');
      expect(button?.textContent).toBe(link?.ref?.name);
      await act(async () => {
        button?.click();
      });
      expect(parts.openReference).toHaveBeenLastCalledWith(expect.objectContaining(link?.ref));
      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
      });
      expect(parts.navigateReference).toHaveBeenLastCalledWith(expect.objectContaining(link?.ref));
    }
    await act(async () => {
      root.render(
        referenceColumns[1].render({
          ...source,
          karpenter: {
            nodeClass: {
              display: {
                clusterId: 'a',
                group: 'karpenter.k8s.aws',
                kind: 'EC2NodeClass',
                name: 'class',
              },
            },
          },
        })
      );
    });
    expect(dom.querySelector('button')).toBeNull();
    expect(dom.textContent).toBe('class');
    await act(async () => {
      root.unmount();
    });
    for (const column of columns) {
      expect(column.render({ ...source, karpenter: undefined })).toBe('-');
    }
  });
});
