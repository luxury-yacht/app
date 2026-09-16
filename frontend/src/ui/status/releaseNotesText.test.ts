/**
 * frontend/src/ui/status/releaseNotesText.test.ts
 *
 * Verifies the release-notes markdown stripper produces clean plain text for the
 * update tooltip preview.
 */
import { describe, expect, it } from 'vitest';

import { toPlainReleaseNotes } from './releaseNotesText';

describe('toPlainReleaseNotes', () => {
  it('preserves nested list content while removing media and standalone rules', () => {
    expect(toPlainReleaseNotes('')).toBe('');
    expect(
      toPlainReleaseNotes(
        '![image](https://example.com/image.png)\r\n---\r\n  - `code` and ~~removed~~\r\n> __note__'
      )
    ).toBe('  • code and removed\nnote');
    expect(toPlainReleaseNotes('[unfinished](target')).toBe('[unfinished](target');
  });
  it('leaves malformed media intact while continuing to process later links', () => {
    expect(toPlainReleaseNotes('![broken] trailing [valid](https://example.com)')).toBe(
      '![broken] trailing valid'
    );
  });

  it('handles a combined release body', () => {
    const md = ['## What changed', '', '- Fixed [the bug](https://x)', '- **Improved** perf'].join(
      '\n'
    );
    expect(toPlainReleaseNotes(md)).toBe('What changed\n\n• Fixed the bug\n• Improved perf');
  });
});
