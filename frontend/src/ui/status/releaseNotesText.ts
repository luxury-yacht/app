/**
 * frontend/src/ui/status/releaseNotesText.ts
 *
 * Converts a GitHub release body (markdown) into clean plain text for the update
 * tooltip preview: strips the common markers (headings, bold, inline code,
 * strikethrough, links, images), drops horizontal rules, and normalizes list
 * bullets to "•". Intentionally lightweight — not a markdown parser; the fully
 * rendered notes are one click away on the release page. No HTML is produced.
 */
export const toPlainReleaseNotes = (markdown: string): string => {
  if (!markdown) {
    return '';
  }

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const transformed = lines.map((line) => {
    let text = line;
    // Images have no place in a text preview — drop them entirely.
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    // Links [text](url) -> text.
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    // Horizontal rules (---, ***, ___) become a blank line.
    if (/^\s*([-*_])\1{2,}\s*$/.test(text)) {
      return '';
    }
    // Leading list marker (-, *, +) -> bullet, preserving indentation.
    text = text.replace(/^(\s*)[-*+]\s+/, '$1• ');
    // Leading heading (#…) / blockquote (>) markers -> drop marker, keep text.
    text = text.replace(/^\s*#{1,6}\s+/, '');
    text = text.replace(/^\s*>\s?/, '');
    // Inline emphasis / code / strikethrough markers.
    text = text.replace(/\*\*|__|~~|`/g, '');
    return text.replace(/\s+$/, '');
  });

  // Collapse runs of blank lines so stripped headings/rules don't leave gaps,
  // then drop leading/trailing blank lines (but keep the first line's indentation
  // so a leading nested bullet stays nested).
  return transformed
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
};
