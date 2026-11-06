/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logLineFormats.ts
 *
 * Reads a log line as structured fields when it is in a format we recognize:
 * a JSON object, klog (Kubernetes components), or logfmt (Go tools such as
 * Prometheus, slog, logrus). The Pretty and Table views and level detection
 * read these fields. klog and logfmt values stay strings.
 */

import { stripAnsi } from './ansi';

export type LogLineFields = Record<string, unknown>;

// Only text whose first visible character is "{" can parse to an object;
// checking first keeps plain-text lines from throwing in JSON.parse.
const OBJECT_START = /^\s*\{/;

const parseJsonObject = (text: string): LogLineFields | null => {
  if (!OBJECT_START.test(text)) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return Object.keys(parsed).length > 0 ? (parsed as LogLineFields) : null;
  } catch {
    return null;
  }
};

const QUOTE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r' };

// Reads a double-quoted value starting at `start` (the opening quote). Returns
// the unquoted text and the index after the closing quote, or null when the
// quote never closes.
const readQuoted = (text: string, start: number): { value: string; end: number } | null => {
  let value = '';
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '"') {
      return { value, end: index + 1 };
    }
    if (char === '\\' && index + 1 < text.length) {
      index += 1;
      const escaped = text.charAt(index);
      value += QUOTE_ESCAPES[escaped] ?? escaped;
    } else {
      value += char;
    }
  }
  return null;
};

const LOGFMT_KEY = /[A-Za-z_][\w.\-/@]*/y;
const LOGFMT_START = /^[A-Za-z_][\w.\-/@]*=/;
const isSpace = (char: string) => char === ' ' || char === '\t';

// One `key=value` pair at `start`; a quoted value must be followed by a space
// or the end of the line.
const readPair = (
  text: string,
  start: number
): { key: string; value: string; end: number } | null => {
  LOGFMT_KEY.lastIndex = start;
  const key = LOGFMT_KEY.exec(text)?.[0];
  const equals = start + (key?.length ?? 0);
  if (!key || text.charAt(equals) !== '=') {
    return null;
  }
  if (text.charAt(equals + 1) === '"') {
    const quoted = readQuoted(text, equals + 1);
    if (!quoted || (quoted.end < text.length && !isSpace(text.charAt(quoted.end)))) {
      return null;
    }
    return { key, value: quoted.value, end: quoted.end };
  }
  let end = equals + 1;
  while (end < text.length && !isSpace(text.charAt(end))) {
    end += 1;
  }
  return { key, value: text.slice(equals + 1, end), end };
};

// Every token must be a pair, so prose with one `key=value` in it stays text.
const parseLogfmtPairs = (text: string): { fields: LogLineFields; count: number } | null => {
  const fields: LogLineFields = {};
  let count = 0;
  let index = 0;
  while (index < text.length) {
    if (isSpace(text.charAt(index))) {
      index += 1;
      continue;
    }
    const pair = readPair(text, index);
    if (!pair) {
      return null;
    }
    fields[pair.key] = pair.value;
    count += 1;
    index = pair.end;
  }
  return { fields, count };
};

// A lone pair is too likely to be prose; logfmt lines carry several.
const MIN_LOGFMT_PAIRS = 2;

const parseLogfmt = (text: string): LogLineFields | null => {
  const trimmed = text.trim();
  if (!LOGFMT_START.test(trimmed)) {
    return null;
  }
  const parsed = parseLogfmtPairs(trimmed);
  return parsed && parsed.count >= MIN_LOGFMT_PAIRS ? parsed.fields : null;
};

// klog: Lmmdd hh:mm:ss.uuuuuu threadid file:line] message
const KLOG_HEADER = /^([IWEF])(\d{4} \d{2}:\d{2}:\d{2}\.\d{6})\s+(\d+) ([^\s\]]+:\d+)\] ?/;
const KLOG_LEVELS: Record<string, string> = { I: 'info', W: 'warn', E: 'error', F: 'fatal' };

// Structured klog (InfoS/ErrorS) writes a quoted message, then pairs. Anything
// else is a printf-style message, kept whole.
const parseKlogMessage = (rest: string): { msg: string; pairs: LogLineFields } => {
  const whole = { msg: rest, pairs: {} };
  const quoted = rest.startsWith('"') ? readQuoted(rest, 0) : null;
  if (!quoted) {
    return whole;
  }
  const tail = rest.slice(quoted.end);
  if (tail.trim().length === 0) {
    return { msg: quoted.value, pairs: {} };
  }
  const parsed = isSpace(tail.charAt(0)) ? parseLogfmtPairs(tail) : null;
  return parsed ? { msg: quoted.value, pairs: parsed.fields } : whole;
};

const parseKlog = (text: string): LogLineFields | null => {
  const header = KLOG_HEADER.exec(text);
  if (!header) {
    return null;
  }
  const [matched, letter = '', time, thread, caller] = header;
  const { msg, pairs } = parseKlogMessage(text.slice(matched.length));
  const fields: LogLineFields = { level: KLOG_LEVELS[letter], time, thread, caller, msg };
  // Header fields win over pairs that reuse their names.
  for (const [key, value] of Object.entries(pairs)) {
    if (!(key in fields)) {
      fields[key] = value;
    }
  }
  return fields;
};

/** The line's fields when it is a JSON object, klog, or logfmt; otherwise null. */
export const parseStructuredLogLine = (line: string): LogLineFields | null => {
  const text = stripAnsi(line);
  return parseJsonObject(text) ?? parseKlog(text) ?? parseLogfmt(text);
};
