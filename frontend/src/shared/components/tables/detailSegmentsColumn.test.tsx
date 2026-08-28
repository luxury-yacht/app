/**
 * frontend/src/shared/components/tables/detailSegmentsColumn.test.tsx
 *
 * Test suite for the shared detail-segments column factory: labeled segment
 * rendering, cross-object link segments, presentation tokens, export text,
 * and auto-width measurement.
 */

import {
  createDetailSegmentsColumn,
  detailSegmentsText,
} from '@shared/components/tables/detailSegmentsColumn';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DetailSegment } from '@/core/refresh/types';

type Row = { details?: DetailSegment[] };

const collectElements = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean,
  found: React.ReactElement[] = []
): React.ReactElement[] => {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectElements(child, predicate, found);
    }
    return found;
  }
  if (React.isValidElement(node)) {
    if (predicate(node)) {
      found.push(node);
    }
    collectElements((node.props as { children?: React.ReactNode }).children, predicate, found);
  }
  return found;
};

const ingressClassLink = {
  ref: {
    clusterId: 'cluster-a',
    group: 'networking.k8s.io',
    version: 'v1',
    kind: 'IngressClass',
    resource: 'ingressclasses',
    name: 'nginx',
  },
};

describe('createDetailSegmentsColumn', () => {
  const buildColumn = (overrides: Parameters<typeof createDetailSegmentsColumn<Row>>[0] = {}) =>
    createDetailSegmentsColumn<Row>({
      getSegments: (row) => row.details,
      ...overrides,
    });

  it('defaults to the details key, header, and non-sortable', () => {
    const column = buildColumn();
    expect(column.key).toBe('details');
    expect(column.header).toBe('Details');
    expect(column.sortable).toBe(false);
  });

  it('renders the no-value marker when segments are missing or empty', () => {
    const column = buildColumn();
    expect(column.render({})).toBe('-');
    expect(column.render({ details: [] })).toBe('-');
  });

  it('renders each segment as labeled text with export text', () => {
    const column = buildColumn();
    const cell = column.render({
      details: [
        { label: 'Class', value: 'nginx' },
        { label: 'Rules', value: '2' },
        { value: 'No rules defined' },
      ],
    });
    const markup = renderToStaticMarkup(cell as React.ReactElement);
    expect(markup).toContain('detail-segment-label');
    expect(markup).toContain('Class');
    expect(markup).toContain('nginx');

    const renderedSegments = collectElements(
      cell,
      (element) =>
        typeof (element.props as { className?: string }).className === 'string' &&
        ((element.props as { className: string }).className
          .split(' ')
          .includes('detail-segment-text') as boolean)
    );
    expect(renderedSegments).toHaveLength(3);
    expect(markup).toContain('·');

    const container = cell as React.ReactElement<{
      title?: string;
      'data-gridtable-export-text'?: string;
      className?: string;
    }>;
    expect(container.props.className).toContain('detail-segments');
    expect(container.props.title).toBe('Class: nginx, Rules: 2, No rules defined');
    expect(container.props['data-gridtable-export-text']).toBe(
      'Class: nginx, Rules: 2, No rules defined'
    );
  });

  it('renders a resolvable link segment as a button that opens and alt-navigates', () => {
    const openReference = vi.fn();
    const navigateReference = vi.fn();
    const column = buildColumn({ openReference, navigateReference, clusterName: 'Prod' });
    const cell = column.render({
      details: [{ label: 'Class', value: 'nginx', link: ingressClassLink }],
    });

    const [button] = collectElements(cell, (element) => element.type === 'button');
    expect(button).toBeTruthy();
    const props = button.props as {
      className?: string;
      'data-gridtable-shortcut-optout'?: string;
      'data-gridtable-rowclick'?: string;
      onClick: (event: {
        altKey: boolean;
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => void;
    };
    // The app's shared clickable-object link style, exactly as Name columns
    // wear it (object-panel-link = muted color, hover brightens+underlines;
    // shared.css guarantees it wins the gridtable-link cascade tie).
    expect(props.className).toBe(
      'gridtable-cell-button gridtable-link object-panel-link detail-segment-value'
    );
    expect(props['data-gridtable-shortcut-optout']).toBe('true');
    expect(props['data-gridtable-rowclick']).toBe('suppress');

    props.onClick({ altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(openReference).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'IngressClass', name: 'nginx', clusterId: 'cluster-a' })
    );

    props.onClick({ altKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(navigateReference).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'IngressClass', name: 'nginx' })
    );
  });

  it('renders a display-only link segment as plain text', () => {
    const openReference = vi.fn();
    const column = buildColumn({ openReference });
    const cell = column.render({
      details: [
        {
          label: 'Class',
          value: 'nginx',
          link: { display: { clusterId: 'cluster-a', kind: 'IngressClass', name: 'nginx' } },
        },
      ],
    });
    expect(collectElements(cell, (element) => element.type === 'button')).toHaveLength(0);
  });

  it('maps a presentation token onto the segment value', () => {
    const column = buildColumn();
    const cell = column.render({
      details: [{ label: 'Not ready', value: '2', presentation: 'warning' }],
    });
    const markup = renderToStaticMarkup(cell as React.ReactElement);
    expect(markup).toContain('detail-segment-value status-text warning');
  });

  it('filters segments to the configured slot and renders the no-value marker when none match', () => {
    const details: DetailSegment[] = [
      { slot: 'reference', value: 'nginx' },
      { slot: 'counts', label: 'Rules', value: '4' },
    ];
    const countsColumn = buildColumn({ slot: 'counts' });
    const markup = renderToStaticMarkup(countsColumn.render({ details }) as React.ReactElement);
    expect(markup).toContain('Rules');
    expect(markup).not.toContain('nginx');

    const addressColumn = buildColumn({ slot: 'address' });
    expect(addressColumn.render({ details })).toBe('-');
  });

  it('renders plain segments with the search expansion in the tooltip', () => {
    const column = buildColumn({ slot: 'address' });
    const cell = column.render({
      details: [
        { slot: 'address', value: '10.0.0.10' },
        {
          slot: 'address',
          label: 'Hosts',
          value: 'web.example.com +2',
          search: 'web.example.com, b.example.com, c.example.com',
        },
      ],
    });
    const markup = renderToStaticMarkup(cell as React.ReactElement);
    expect(markup).toContain('·');

    const container = cell as React.ReactElement<{
      title?: string;
      'data-gridtable-export-text'?: string;
      className?: string;
    }>;
    expect(container.props.className).toBe('detail-segments');
    expect(container.props.title).toBe(
      '10.0.0.10, Hosts: web.example.com, b.example.com, c.example.com'
    );
    expect(container.props['data-gridtable-export-text']).toBe(
      '10.0.0.10, Hosts: web.example.com +2'
    );
  });

  it('keeps labels visibly associated with their values', () => {
    const column = buildColumn({ slot: 'address' });
    const markup = renderToStaticMarkup(
      column.render({
        details: [
          { slot: 'address', label: 'Cluster IP', value: '10.0.0.10' },
          { slot: 'address', label: 'Ports', value: '443/TCP' },
        ],
      }) as React.ReactElement
    );
    expect(markup).toContain('Cluster IP:');
    expect(markup).toContain('Ports:');
  });

  it('renders link segments as buttons', () => {
    const openReference = vi.fn();
    const column = buildColumn({ slot: 'reference', openReference });
    const cell = column.render({
      details: [{ slot: 'reference', value: 'nginx', link: ingressClassLink }],
    });
    const [button] = collectElements(cell, (element) => element.type === 'button');
    expect(button).toBeTruthy();
  });

  it('preserves presentation classes on linked segment values', () => {
    const column = buildColumn({ slot: 'reference', openReference: vi.fn() });
    const cell = column.render({
      details: [
        {
          slot: 'reference',
          value: 'nginx',
          link: ingressClassLink,
          presentation: 'warning',
        },
      ],
    });
    const [button] = collectElements(cell, (element) => element.type === 'button');
    const [presentedValue] = collectElements(
      button,
      (element) =>
        element.type === 'span' &&
        (element.props as { className?: string }).className?.includes('status-text') === true
    );
    expect(presentedValue).toBeTruthy();
    expect((presentedValue.props as { className?: string }).className?.split(' ')).toEqual(
      expect.arrayContaining(['status-text', 'warning'])
    );
  });

  it('leaves auto-width to the render-replica measurement', () => {
    // No measurementText/measurementElement: the measurer's fallback clones the
    // rendered cell so labels, separators, and link styling are measured.
    const column = buildColumn();
    expect(column.measurementText).toBeUndefined();
    expect(column.measurementElement).toBeUndefined();
  });
});

describe('detailSegmentsText', () => {
  it('flattens segments the same way the backend search text does', () => {
    expect(
      detailSegmentsText([{ label: 'Type', value: 'ClusterIP' }, { value: 'No rules defined' }])
    ).toBe('Type: ClusterIP, No rules defined');
    expect(detailSegmentsText([])).toBe('');
    expect(detailSegmentsText(undefined)).toBe('');
  });
});
