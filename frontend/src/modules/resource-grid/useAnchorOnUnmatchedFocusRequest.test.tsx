/**
 * frontend/src/modules/resource-grid/useAnchorOnUnmatchedFocusRequest.test.tsx
 *
 * The "reveal in list" anchor bridge must only fire on the NAVIGATION
 * DESTINATION table. A same-cluster non-target query-backed table (e.g. an
 * object-panel pods list that persists across navigation) must not consume the
 * global focus request and issue a spurious anchor / false not-found.
 */

import type { GridTableFocusRequest } from '@shared/components/tables/hooks/gridTableFocusRequest';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const peek = vi.fn();

vi.mock('@shared/components/tables/hooks/useGridTableExternalFocus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  peekPendingFocusRequest: () => peek() as GridTableFocusRequest | null,
}));

import { useAnchorOnUnmatchedFocusRequest } from './useQueryBackedResourceGridTable';

// A request aimed at the namespace pods view for an object NOT on the loaded page.
const request: GridTableFocusRequest = {
  kind: 'Pod',
  name: 'web-5',
  namespace: 'shop',
  clusterId: 'c1',
  version: 'v1',
  destinationViewId: 'namespace-pods',
};

const Harness = ({ viewId, anchorTo }: { viewId: string; anchorTo: (anchor: unknown) => void }) => {
  useAnchorOnUnmatchedFocusRequest<{ name: string }>({
    clusterId: 'c1',
    domain: 'pods',
    viewId,
    loaded: true,
    rows: [], // empty page → the target is not on it → eligible to anchor
    anchorTo,
    anchorResult: null,
  });
  return null;
};

describe('useAnchorOnUnmatchedFocusRequest — destination scoping', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    peek.mockReturnValue(request);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    peek.mockReset();
  });

  it('anchors when this table IS the destination (viewId matches)', () => {
    const anchorTo = vi.fn();
    act(() => {
      root.render(<Harness viewId="namespace-pods" anchorTo={anchorTo} />);
    });
    expect(anchorTo).toHaveBeenCalledTimes(1);
    expect(anchorTo.mock.calls[0][0]).toMatchObject({ kind: 'Pod', name: 'web-5' });
  });

  it('does NOT anchor when this table is not the destination (object-panel pods)', () => {
    const anchorTo = vi.fn();
    act(() => {
      root.render(<Harness viewId="object-panel-pods" anchorTo={anchorTo} />);
    });
    expect(anchorTo).not.toHaveBeenCalled();
  });

  it('does NOT anchor a request with no destination', () => {
    const anchorTo = vi.fn();
    peek.mockReturnValue({ ...request, destinationViewId: undefined });
    act(() => {
      root.render(<Harness viewId="namespace-pods" anchorTo={anchorTo} />);
    });
    expect(anchorTo).not.toHaveBeenCalled();
  });
});
