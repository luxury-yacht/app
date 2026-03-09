/**
 * frontend/src/ui/modals/create-resource/commandInputUtils.ts
 *
 * Utilities for the command-input field type. Handles parsing and
 * formatting container command/args values across three input modes:
 *   - Command:      shell-style tokenization (e.g., `/bin/sh -c "hello world"`)
 *   - Shell Script: entire text becomes a single array item
 *   - Raw YAML:     user writes YAML sequence syntax directly
 */

import * as YAML from 'yaml';

export type CommandInputMode = 'command' | 'script' | 'raw-yaml';

// ─── Shell Tokenisation ──────────────────────────────────────────────────

/**
 * Tokenise a string the way a POSIX shell would: split on unquoted
 * whitespace, respecting single and double quotes.
 *
 *   shellTokenize('/bin/sh -c "hello world"')
 *   // => ["/bin/sh", "-c", "hello world"]
 */
export function shellTokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  // Track whether we've seen a quote for the current token so that
  // an explicitly empty string like "" still produces a token.
  let hasQuote = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
    } else if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === '\\' && i + 1 < input.length && input[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        current += ch;
      }
    } else if (ch === "'") {
      inSingle = true;
      hasQuote = true;
    } else if (ch === '"') {
      inDouble = true;
      hasQuote = true;
    } else if (ch === ' ' || ch === '\t') {
      if (current !== '' || hasQuote) {
        tokens.push(current);
        current = '';
        hasQuote = false;
      }
    } else {
      current += ch;
    }
    i++;
  }

  if (current !== '' || hasQuote) tokens.push(current);
  return tokens;
}

/**
 * Join an array of strings into a shell-style command string.
 * Tokens containing whitespace or quote characters are double-quoted.
 *
 *   shellJoin(["/bin/sh", "-c", "hello world"])
 *   // => '/bin/sh -c "hello world"'
 */
export function shellJoin(tokens: string[]): string {
  return tokens
    .map((token) => {
      if (token === '') return '""';
      // No quoting needed when the token has no special characters.
      if (!/[\s"'\\]/.test(token)) return token;
      // Wrap in double quotes, escaping embedded double quotes and backslashes.
      return `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    })
    .join(' ');
}

// ─── Mode Inference ──────────────────────────────────────────────────────

/**
 * Infer the most appropriate input mode from an existing YAML array value.
 * Falls back to 'command' for empty or simple string arrays.
 */
export function inferMode(arr: string[]): CommandInputMode {
  if (arr.length === 0) return 'command';
  // If any item contains newlines it is almost certainly a shell script
  // passed as a single array element via a YAML block scalar.
  if (arr.some((item) => item.includes('\n'))) return 'script';
  return 'command';
}

// ─── Display / Parse ─────────────────────────────────────────────────────

/**
 * Convert a string array to the display text for a given input mode.
 */
export function arrayToDisplayText(arr: string[], mode: CommandInputMode): string {
  if (arr.length === 0) return '';
  switch (mode) {
    case 'command':
      return shellJoin(arr);
    case 'script':
      // Shell Script mode expects the script as the single first item.
      return arr[0];
    case 'raw-yaml':
      return YAML.stringify(arr).trimEnd();
  }
}

/**
 * Parse display text back into a string array for a given input mode.
 * Returns null if the text cannot be parsed (validation error).
 */
export function parseDisplayText(text: string, mode: CommandInputMode): string[] | null {
  const trimmed = text.trim();
  if (trimmed === '') return [];

  switch (mode) {
    case 'command':
      return shellTokenize(trimmed);
    case 'script':
      // The entire text becomes a single array item.
      return [text];
    case 'raw-yaml': {
      try {
        const parsed = YAML.parse(trimmed);
        if (!Array.isArray(parsed)) return null;
        // Ensure every element is stringifiable.
        return parsed.map((item) => String(item));
      } catch {
        return null;
      }
    }
  }
}
