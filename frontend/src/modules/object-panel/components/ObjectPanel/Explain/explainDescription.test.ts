/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Explain/explainDescription.test.ts
 *
 * Schema descriptions are plain text written for terminals and Go comments.
 * The Explain tab reflows prose to the panel, so the parser must tell a hard
 * wrap from a paragraph, a list, or an indented example.
 */

import { describe, expect, it } from 'vitest';
import {
  type DescriptionBlock,
  parseExplainDescription,
  splitInlineText,
} from './explainDescription';

// Keys only keep rendering stable; the structure is what a reader sees.
const structure = (text: string) =>
  parseExplainDescription(text).map((block: DescriptionBlock) =>
    block.kind === 'list'
      ? { kind: block.kind, items: block.items.map((item) => item.text) }
      : { kind: block.kind, text: block.text }
  );

describe('parseExplainDescription', () => {
  it('reflows wrapped prose and keeps paragraphs, lists and indented examples', () => {
    expect(
      structure(
        [
          'Spec defines the desired state',
          'of the widget.',
          '',
          'Valid values are:',
          ' - Fast: runs at',
          'full speed',
          '* Slow',
          '   when idle',
          '',
          'For example:',
          '',
          '    kind: Widget',
          '    spec:',
          '      size: 3',
        ].join('\n')
      )
    ).toEqual([
      { kind: 'paragraph', text: 'Spec defines the desired state of the widget.' },
      { kind: 'paragraph', text: 'Valid values are:' },
      { kind: 'list', items: ['Fast: runs at full speed', 'Slow when idle'] },
      { kind: 'paragraph', text: 'For example:' },
      { kind: 'preformatted', text: 'kind: Widget\nspec:\n  size: 3' },
    ]);
  });

  it('has nothing to show for an empty description', () => {
    expect(parseExplainDescription('')).toEqual([]);
    expect(parseExplainDescription('\n\n')).toEqual([]);
  });

  it('keeps a nested YAML sequence in its indented example', () => {
    expect(
      structure(
        'Example:\n\n    containers:\n      - name: app\n        image: example/app\n\n- A prose item'
      )
    ).toEqual([
      { kind: 'paragraph', text: 'Example:' },
      { kind: 'preformatted', text: 'containers:\n  - name: app\n    image: example/app' },
      { kind: 'list', items: ['A prose item'] },
    ]);
  });
});

describe('splitInlineText', () => {
  it('keeps balanced link parentheses and leaves a long unmatched suffix in prose', () => {
    const link = 'https://example.io/a_(b)';
    const suffix = `${')'.repeat(4096)}. Next.`;
    expect(splitInlineText(link + suffix)).toEqual([
      { kind: 'link', key: 0, text: link },
      { kind: 'text', key: link.length, text: suffix },
    ]);
  });

  it('finds code spans and links, leaving sentence punctuation outside the link', () => {
    expect(
      splitInlineText(
        'Set `spec.replicas` (see https://example.io/docs/scale). More: https://example.io/a_(b).'
      ).map(({ kind, text }) => ({ kind, text }))
    ).toEqual([
      { kind: 'text', text: 'Set ' },
      { kind: 'code', text: 'spec.replicas' },
      { kind: 'text', text: ' (see ' },
      { kind: 'link', text: 'https://example.io/docs/scale' },
      { kind: 'text', text: '). More: ' },
      { kind: 'link', text: 'https://example.io/a_(b)' },
      { kind: 'text', text: '.' },
    ]);
  });
});
