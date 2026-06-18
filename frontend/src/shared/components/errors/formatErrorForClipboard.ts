/**
 * frontend/src/shared/components/errors/formatErrorForClipboard.ts
 *
 * Builds the plain-text representation copied by an error notification's
 * "Copy error" button. Keeps the report readable while staying close to the
 * fields shown on screen (category, message, technical details, suggestions,
 * and serializable context).
 */

import { ErrorDetails } from '@utils/errorHandler';

/**
 * Serializes the error context, dropping non-serializable values (e.g. the
 * retry callback stashed on retryable errors). Returns null when nothing
 * useful remains or the context cannot be serialized (e.g. circular refs).
 */
const serializeContext = (context: ErrorDetails['context']): string | null => {
  if (!context) {
    return null;
  }
  try {
    const json = JSON.stringify(context, null, 2);
    // JSON.stringify omits function values, so a context of only callbacks
    // collapses to '{}' — treat that as no context.
    if (!json || json === '{}') {
      return null;
    }
    return json;
  } catch {
    return null;
  }
};

/** Formats an error notification as a plain-text block for the clipboard. */
export const formatErrorForClipboard = (error: ErrorDetails): string => {
  const primary = (error.userMessage || error.message || '').trim();
  const lines: string[] = [error.category ? `[${error.category}] ${primary}`.trim() : primary];

  const technical = error.technicalMessage?.trim();
  if (technical && technical !== primary) {
    lines.push('', 'Technical details:', technical);
  }

  if (error.suggestions && error.suggestions.length > 0) {
    lines.push('', 'Suggestions:');
    for (const suggestion of error.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  const context = serializeContext(error.context);
  if (context) {
    lines.push('', 'Context:', context);
  }

  return lines.join('\n');
};
