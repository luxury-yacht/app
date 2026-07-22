/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogMessageRenderer.tsx
 *
 * Shared log-line renderer for the container-logs and node-logs tabs:
 * search-match highlighting composed with ANSI color segmentation. The two
 * tabs differ only in how a style-less ANSI segment is wrapped (historical
 * DOM: LogViewer uses a keyed fragment, NodeLogsTab a keyed span), preserved
 * via `plainSegmentWrapper`.
 */

import React, { useCallback } from 'react';
import { containsAnsi, parseAnsiTextSegments, stripAnsi } from '../ansi';
import type { useTerminalTheme } from './useTerminalTheme';

export function useLogMessageRenderer({
  highlightRegex,
  showAnsiColors,
  terminalTheme,
  plainSegmentWrapper,
}: {
  highlightRegex: RegExp | null;
  showAnsiColors: boolean;
  terminalTheme: ReturnType<typeof useTerminalTheme>;
  plainSegmentWrapper: 'fragment' | 'span';
}) {
  const renderHighlightedMessage = useCallback(
    (text: string, keyPrefix: string) => {
      if (!text) {
        return '\u00A0';
      }
      if (!highlightRegex) {
        return text;
      }

      const matches = Array.from(text.matchAll(highlightRegex));
      if (matches.length === 0) {
        return text;
      }

      const nodes: React.ReactNode[] = [];
      let lastIndex = 0;

      matches.forEach((match, index) => {
        const matchIndex = match.index ?? -1;
        const value = match[0] ?? '';
        if (matchIndex < 0 || value.length === 0) {
          return;
        }
        if (matchIndex > lastIndex) {
          nodes.push(text.slice(lastIndex, matchIndex));
        }
        nodes.push(
          <mark key={`${keyPrefix}-${matchIndex}-${index}`} className="log-viewer-highlight">
            {value}
          </mark>
        );
        lastIndex = matchIndex + value.length;
      });

      if (nodes.length === 0) {
        return text;
      }
      if (lastIndex < text.length) {
        nodes.push(text.slice(lastIndex));
      }
      return nodes;
    },
    [highlightRegex]
  );

  const renderMessageContent = useCallback(
    (text: string, keyPrefix: string) => {
      const normalizedText = showAnsiColors ? text : stripAnsi(text);
      if (!showAnsiColors || !containsAnsi(text)) {
        return renderHighlightedMessage(normalizedText, keyPrefix);
      }

      const segments = parseAnsiTextSegments(text, terminalTheme);
      if (segments.length === 0) {
        return renderHighlightedMessage(stripAnsi(text), keyPrefix);
      }

      return segments.map((segment, index) => {
        const content = renderHighlightedMessage(segment.text, `${keyPrefix}-${index}`);
        if (Object.keys(segment.style).length === 0) {
          return plainSegmentWrapper === 'fragment' ? (
            <React.Fragment key={`${keyPrefix}-plain-${index}`}>{content}</React.Fragment>
          ) : (
            <span key={`${keyPrefix}-plain-${index}`}>{content}</span>
          );
        }
        return (
          <span key={`${keyPrefix}-ansi-${index}`} style={segment.style}>
            {content}
          </span>
        );
      });
    },
    [plainSegmentWrapper, renderHighlightedMessage, showAnsiColors, terminalTheme]
  );

  return renderMessageContent;
}
