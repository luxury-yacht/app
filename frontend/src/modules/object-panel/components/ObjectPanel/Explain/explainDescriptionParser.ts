/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Explain/explainDescriptionParser.ts
 *
 * Reads a schema description for display. Descriptions are plain text, often
 * hard-wrapped in Go comments: a line break inside prose is a wrap, a blank
 * line ends a paragraph, a line starting with `-` or `*` starts a list item,
 * and an indented line outside a list belongs to an example shown as written.
 * Keys are positions in the source text, so they stay stable for a given text.
 */

export interface DescriptionListItem {
  key: number;
  text: string;
}

export type DescriptionBlock =
  | { kind: 'paragraph'; key: number; text: string }
  | { kind: 'list'; key: number; items: DescriptionListItem[] }
  | { kind: 'preformatted'; key: number; text: string };

export interface InlinePart {
  kind: 'text' | 'code' | 'link';
  key: number;
  text: string;
}

const BULLET_PREFIX = /^\s*[-*]\s+/;
const LINE_BREAK = /[\r\n\u2028\u2029]/;
const INDENTED = /^(?: {2,}|\t)/;

const appendToList = (
  blocks: DescriptionBlock[],
  current: DescriptionBlock | undefined,
  line: string,
  index: number
) => {
  // Read the prefix separately so the body cannot backtrack over its whitespace.
  const prefix = BULLET_PREFIX.exec(line);
  const text = prefix ? line.slice(prefix[0].length) : undefined;
  if (text !== undefined && !LINE_BREAK.test(text)) {
    const item = { key: index, text: text.trimEnd() };
    if (current?.kind === 'list') {
      current.items.push(item);
    } else {
      blocks.push({ kind: 'list', key: index, items: [item] });
    }
    return true;
  }
  if (current?.kind !== 'list') {
    return false;
  }
  // Inside a list, any other line continues the item above it.
  const item = current.items[current.items.length - 1];
  item.text = `${item.text} ${line.trim()}`;
  return true;
};

const appendLine = (
  blocks: DescriptionBlock[],
  current: DescriptionBlock | undefined,
  line: string,
  index: number
) => {
  const indented = INDENTED.test(line);
  if (indented && current?.kind === 'preformatted') {
    current.text = `${current.text}\n${line}`;
    return;
  }
  if (appendToList(blocks, current, line, index)) {
    return;
  }
  if (indented) {
    blocks.push({ kind: 'preformatted', key: index, text: line });
    return;
  }
  if (current?.kind === 'paragraph') {
    current.text = `${current.text} ${line.trim()}`;
  } else {
    blocks.push({ kind: 'paragraph', key: index, text: line.trim() });
  }
};

// An example keeps its own indentation, less what all of its lines share.
const dedent = (block: DescriptionBlock): DescriptionBlock => {
  if (block.kind !== 'preformatted') {
    return block;
  }
  const lines = block.text.split('\n');
  const shared = Math.min(...lines.map((line) => line.length - line.trimStart().length));
  return { ...block, text: lines.map((line) => line.slice(shared)).join('\n') };
};

export const parseExplainDescription = (text: string): DescriptionBlock[] => {
  const blocks: DescriptionBlock[] = [];
  // Whether the next line may continue the last block; a blank line ends it.
  let continues = false;
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') {
      continues = false;
      return;
    }
    appendLine(blocks, continues ? blocks[blocks.length - 1] : undefined, line, index);
    continues = true;
  });
  return blocks.map(dedent);
};

const INLINE = /`([^`]+)`|https?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = '.,;:!?';

const unmatchedClosingParens = (text: string): number => {
  let balance = 0;
  for (const char of text) {
    if (char === ')') {
      balance += 1;
    } else if (char === '(') {
      balance -= 1;
    }
  }
  return balance;
};

// Sentence punctuation after a link is not part of it; nor is a closing
// parenthesis the link did not open.
const trimLink = (url: string): string => {
  let end = url.length;
  let excess = unmatchedClosingParens(url);
  while (end > 0) {
    const last = url.charAt(end - 1);
    if (last === ')' && excess > 0) {
      excess -= 1;
    } else if (!TRAILING_PUNCTUATION.includes(last)) {
      break;
    }
    end -= 1;
  }
  return url.slice(0, end);
};

/** Splits text into plain runs, `code` spans and http(s) links. */
export const splitInlineText = (text: string): InlinePart[] => {
  const parts: InlinePart[] = [];
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    const code = match[1];
    const value = code ?? trimLink(match[0]);
    if (start > index) {
      parts.push({ kind: 'text', key: index, text: text.slice(index, start) });
    }
    parts.push({ kind: code === undefined ? 'link' : 'code', key: start, text: value });
    index = code === undefined ? start + value.length : start + match[0].length;
  }
  if (index < text.length) {
    parts.push({ kind: 'text', key: index, text: text.slice(index) });
  }
  return parts;
};
