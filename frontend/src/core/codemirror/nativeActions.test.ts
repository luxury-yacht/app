/**
 * frontend/src/core/codemirror/nativeActions.test.ts
 *
 * Test suite for nativeActions.
 * Covers key behaviors and edge cases for nativeActions.
 */

import type { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cutCodeMirrorSelection, selectCodeMirrorContent } from './nativeActions';

type FakeView = EditorView & {
  dispatch: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
};

const makeView = (doc: string, ranges: Array<{ from: number; to: number }>): FakeView => {
  return {
    state: {
      doc: { length: doc.length, toString: () => doc },
      selection: {
        main: ranges[0] ?? { from: 0, to: 0, empty: true },
        ranges: ranges.length
          ? ranges.map((range) => ({ ...range, empty: range.from === range.to }))
          : [{ from: 0, to: 0, empty: true }],
      },
      sliceDoc: (from: number, to: number) => doc.slice(from, to),
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
  } as unknown as FakeView;
};

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

describe('selectCodeMirrorContent', () => {
  it('selects the entire document through editor state', () => {
    // A DOM range only covers the virtualized viewport; the selection must be
    // set on editor state so copy reads the full document.
    const view = makeView('kind: ConfigMap\nmetadata:\n  name: demo\n', []);

    expect(selectCodeMirrorContent(view)).toBe(true);
    expect(view.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 0, head: view.state.doc.length },
      })
    );
    expect(view.focus).toHaveBeenCalled();
  });

  it('returns false without a view', () => {
    expect(selectCodeMirrorContent(null)).toBe(false);
  });
});

describe('cutCodeMirrorSelection', () => {
  it('copies the selection and deletes it from the document', () => {
    const view = makeView('kind: ConfigMap\n', [{ from: 0, to: 4 }]);

    expect(cutCodeMirrorSelection(view)).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('kind');
    expect(view.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{ from: 0, to: 4, insert: '' }],
      })
    );
    expect(view.focus).toHaveBeenCalled();
  });

  it('returns false and leaves the document alone when nothing is selected', () => {
    const view = makeView('kind: ConfigMap\n', []);

    expect(cutCodeMirrorSelection(view)).toBe(false);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it('returns false without a view', () => {
    expect(cutCodeMirrorSelection(null)).toBe(false);
  });
});
