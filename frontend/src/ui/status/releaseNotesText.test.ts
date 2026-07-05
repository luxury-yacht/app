/**
 * frontend/src/ui/status/releaseNotesText.test.ts
 *
 * Verifies the release-notes markdown stripper produces clean plain text for the
 * update tooltip preview.
 */
import { describe, expect, it } from 'vitest';

import { toPlainReleaseNotes } from './releaseNotesText';

describe('toPlainReleaseNotes', () => {
  it('returns empty string for empty input', () => {
    expect(toPlainReleaseNotes('')).toBe('');
  });

  it('strips heading markers, keeping the text', () => {
    expect(toPlainReleaseNotes('## Highlights')).toBe('Highlights');
    expect(toPlainReleaseNotes('#### Deep heading')).toBe('Deep heading');
  });

  it('removes bold, inline code, and strikethrough markers', () => {
    expect(toPlainReleaseNotes('**bold** and `code` and ~~gone~~')).toBe('bold and code and gone');
    expect(toPlainReleaseNotes('__also bold__')).toBe('also bold');
  });

  it('reduces links to their text and drops images', () => {
    expect(toPlainReleaseNotes('see [the docs](https://example.com/docs)')).toBe('see the docs');
    expect(toPlainReleaseNotes('![screenshot](https://example.com/s.png)')).toBe('');
  });

  it('normalizes list bullets to • and preserves indentation', () => {
    expect(toPlainReleaseNotes('- one\n* two\n+ three')).toBe('• one\n• two\n• three');
    expect(toPlainReleaseNotes('  - nested')).toBe('  • nested');
  });

  it('drops horizontal rules and blockquote markers', () => {
    expect(toPlainReleaseNotes('above\n---\nbelow')).toBe('above\n\nbelow');
    expect(toPlainReleaseNotes('> a quoted note')).toBe('a quoted note');
  });

  it('handles a combined release body', () => {
    const md = ['## What changed', '', '- Fixed [the bug](https://x)', '- **Improved** perf'].join(
      '\n'
    );
    expect(toPlainReleaseNotes(md)).toBe('What changed\n\n• Fixed the bug\n• Improved perf');
  });
});
