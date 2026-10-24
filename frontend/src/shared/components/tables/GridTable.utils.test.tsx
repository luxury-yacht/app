/**
 * frontend/src/shared/components/tables/GridTable.utils.test.tsx
 *
 * Test suite for GridTable.utils.
 * Covers key behaviors and edge cases for GridTable.utils.
 */

import type { ColumnWidthInput } from '@shared/components/tables/GridTable.types';

import {
  buildClusterScopedKey,
  DEFAULT_FONT_SIZE,
  defaultGetKind,
  defaultGetNamespace,
  defaultGetSearchText,
  detectWidthUnit,
  getGridTableRowDetailId,
  getTextContent,
  parseWidthInputToNumber,
  revealVertically,
} from '@shared/components/tables/GridTable.utils';
import { afterEach, describe, expect, it } from 'vitest';

describe('GridTable utils', () => {
  it('extracts kind, namespace, and search text defaults', () => {
    const row = {
      name: 'pod-1',
      namespaceDisplay: 'kube-system',
      kindDisplay: 'Pod',
      item: { kind: 'Pod', namespace: 'kube-system', name: 'pod-1' },
    };
    expect(defaultGetKind(row)).toBe('Pod');
    expect(defaultGetNamespace(row)).toBe('kube-system');
    expect(defaultGetNamespace({ namespaceDisplay: '—' })).toBe('');
    expect(defaultGetNamespace({ namespaceDisplay: '-' })).toBe('');

    const search = defaultGetSearchText(row);
    expect(search).toContain('pod-1');
    expect(search).toContain('kube-system');
    expect(search).toContain('Pod');
  });

  it('derives text content from React nodes', () => {
    expect(getTextContent('plain')).toBe('plain');
    expect(getTextContent(42)).toBe('42');
    expect(getTextContent(['a', 'b'])).toBe('ab');
    expect(getTextContent(<span title="fallback" />)).toBe('fallback');
    expect(getTextContent(<div>child</div>)).toBe('child');
    expect(getTextContent(<span data-gridtable-export-text="exported">child</span>)).toBe(
      'exported'
    );
  });

  it('parses and detects width inputs', () => {
    expect(detectWidthUnit(undefined)).toBe('px');
    expect(detectWidthUnit('50%')).toBe('%');
    expect(parseWidthInputToNumber(120)).toBe(120);
    expect(parseWidthInputToNumber('2em')).toBe(2 * DEFAULT_FONT_SIZE);
    expect(parseWidthInputToNumber('30px')).toBe(30);
    expect(parseWidthInputToNumber('auto')).toBeNull();
    const invalid = '10vh' as unknown as ColumnWidthInput;
    expect(parseWidthInputToNumber(invalid)).toBeNull();
  });

  it('builds cluster-scoped keys using clusterId only', () => {
    // With clusterId present, key is prefixed.
    expect(buildClusterScopedKey({ clusterId: 'alpha:dev' }, 'pod-1')).toBe('alpha:dev|pod-1');
    expect(buildClusterScopedKey({ item: { clusterId: 'beta:prod' } }, 'svc-1')).toBe(
      'beta:prod|svc-1'
    );
  });

  it('throws when clusterId is missing', () => {
    // Without clusterId, buildClusterScopedKey throws to prevent silent key
    // collisions in multi-cluster views.
    expect(() => buildClusterScopedKey({ clusterName: 'dev' }, 'pod-1')).toThrow(
      /requires clusterId/
    );
    expect(() => buildClusterScopedKey({ item: { clusterName: 'prod' } }, 'svc-1')).toThrow(
      /requires clusterId/
    );
    expect(() => buildClusterScopedKey({}, 'deploy-1')).toThrow(/requires clusterId/);
    expect(() => buildClusterScopedKey(null, 'job-1')).toThrow(/requires clusterId/);
  });

  it('produces different keys for same name in different clusters', () => {
    const rowA = { clusterId: 'cluster-a', name: 'app' };
    const rowB = { clusterId: 'cluster-b', name: 'app' };
    const keyA = buildClusterScopedKey(rowA, 'app');
    const keyB = buildClusterScopedKey(rowB, 'app');
    expect(keyA).not.toBe(keyB);
    expect(keyA).toBe('cluster-a|app');
    expect(keyB).toBe('cluster-b|app');
  });

  // A detail's id is its opening control's aria-controls target, so distinct
  // row keys must never share one.
  describe('getGridTableRowDetailId', () => {
    it('hex-encodes special characters to preserve uniqueness', () => {
      const idSlash = getGridTableRowDetailId('a/b');
      const idColon = getGridTableRowDetailId('a:b');
      const idPipe = getGridTableRowDetailId('a|b');
      expect(idSlash).not.toBe(idColon);
      expect(idSlash).not.toBe(idPipe);
      expect(idColon).not.toBe(idPipe);
    });

    it('builds a valid id from a cluster-scoped key', () => {
      const id = getGridTableRowDetailId('cluster-1|pod:default/nginx');
      expect(id).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
    });
  });

  // Keyboard moves reveal the highlighted row. WebKit's scrollIntoView also
  // scrolls ancestors sideways to line up a row nested in an expanded table
  // (wider than the parent and starting inside it), shifting the parent table on
  // every key press, so the reveal moves only scrollTop.
  describe('revealVertically', () => {
    const viewport = { top: 100, height: 200 };
    const setRect = (element: HTMLElement, top: number, height: number, left = 0, width = 400) => {
      element.getBoundingClientRect = () =>
        DOMRect.fromRect({ x: left, y: top, width, height }) as DOMRect;
    };
    const setScroll = (element: HTMLElement, scrollHeight: number, clientHeight: number) => {
      Object.defineProperty(element, 'scrollHeight', { value: scrollHeight });
      Object.defineProperty(element, 'clientHeight', { value: clientHeight });
      Object.defineProperty(element, 'scrollTop', { value: 50, writable: true });
      Object.defineProperty(element, 'scrollLeft', { value: 30, writable: true });
    };
    // Positions are given in CSS pixels; at a page zoom, bounding rects report
    // them in zoomed pixels while scroll and client sizes stay in CSS pixels.
    const layout = (rowTop: number, rowHeight: number, zoom = 1) => {
      const parent = document.createElement('div');
      const nested = document.createElement('div');
      const row = document.createElement('div');
      parent.appendChild(nested).appendChild(row);
      setRect(parent, viewport.top * zoom, viewport.height * zoom);
      setScroll(parent, 2000, viewport.height);
      // The nested table scrolls only sideways, so it is left alone.
      setRect(nested, viewport.top * zoom, 600 * zoom);
      setScroll(nested, 600, 600);
      // A nested row starts inside the parent and is wider than it.
      setRect(row, rowTop * zoom, rowHeight * zoom, 17 * zoom, 900 * zoom);
      return { parent, nested, row };
    };
    afterEach(() => {
      document.documentElement.style.removeProperty('--app-zoom-factor');
    });

    it.each([
      { position: 'below the viewport', rowTop: 320, rowHeight: 40, scrollTop: 50 + 60 },
      { position: 'above the viewport', rowTop: 80, rowHeight: 40, scrollTop: 50 - 20 },
      { position: 'inside the viewport', rowTop: 150, rowHeight: 40, scrollTop: 50 },
      // A detail taller than the viewport shows its start.
      {
        position: 'taller than the viewport, starting inside it',
        rowTop: 200,
        rowHeight: 500,
        scrollTop: 50 + 100,
      },
      {
        position: 'taller than the viewport, ending inside it',
        rowTop: -300,
        rowHeight: 500,
        scrollTop: 50 - 100,
      },
      { position: 'spanning the whole viewport', rowTop: 50, rowHeight: 400, scrollTop: 50 },
    ])(
      'scrolls just far enough to show a row $position, never sideways',
      ({ rowTop, rowHeight, scrollTop }) => {
        const { parent, nested, row } = layout(rowTop, rowHeight);

        revealVertically(row);

        expect(parent.scrollTop).toBe(scrollTop);
        expect(parent.scrollLeft).toBe(30);
        expect(nested.scrollTop).toBe(50);
        expect(nested.scrollLeft).toBe(30);
      }
    );

    it.each([
      { zoom: 0.5, position: 'below', rowTop: 320, scrollTop: 50 + 60 },
      { zoom: 0.5, position: 'above', rowTop: 80, scrollTop: 50 - 20 },
      { zoom: 2, position: 'below', rowTop: 320, scrollTop: 50 + 60 },
      { zoom: 2, position: 'above', rowTop: 80, scrollTop: 50 - 20 },
    ])(
      'scrolls just far enough at $zoom page zoom to show a row $position the viewport',
      ({ zoom, rowTop, scrollTop }) => {
        document.documentElement.style.setProperty('--app-zoom-factor', `${zoom}`);
        const { parent, row } = layout(rowTop, 40, zoom);

        revealVertically(row);

        expect(parent.scrollTop).toBe(scrollTop);
        expect(parent.scrollLeft).toBe(30);
      }
    );

    // Browsers keep scroll positions in whole pixels while rows at a page zoom
    // sit at fractional positions, so the reveal rounds outward: a short scroll
    // would leave the row's edge clipped.
    it.each([
      { position: 'below', rowTop: 320.4, scrollTop: 50 + 61 },
      { position: 'above', rowTop: 79.6, scrollTop: 50 - 21 },
    ])(
      'rounds the scroll outward to fully show a row $position the viewport at a fractional position',
      ({ rowTop, scrollTop }) => {
        const { parent, row } = layout(rowTop, 40);

        revealVertically(row);

        expect(parent.scrollTop).toBe(scrollTop);
      }
    );
  });
});
