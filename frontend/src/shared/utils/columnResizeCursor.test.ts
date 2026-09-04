import { describe, expect, it } from 'vitest';
import { acquireColumnResizeCursor } from './columnResizeCursor';

describe('column resize cursor ownership', () => {
  it('keeps the cursor until all gestures finish and makes cleanup idempotent', () => {
    const releaseFirst = acquireColumnResizeCursor();
    const releaseSecond = acquireColumnResizeCursor();
    try {
      expect(document.body.classList.contains('column-resizing')).toBe(true);
      releaseFirst();
      releaseFirst();
      expect(document.body.classList.contains('column-resizing')).toBe(true);
      releaseSecond();
      expect(document.body.classList.contains('column-resizing')).toBe(false);
    } finally {
      releaseFirst();
      releaseSecond();
    }
  });
});
