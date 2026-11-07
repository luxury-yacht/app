/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logLevels.ts
 *
 * Log levels for the Log Levels filter. A structured line's level comes from
 * its level field; a plain-text line's from a level word near its start. A
 * line without one (a stack-trace line, a bare print) takes the level of the
 * previous leveled line from the same source.
 */

import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import {
  filterSelectionValues,
  type MultiSelectFilterSelection,
} from '@shared/components/dropdowns/multiSelectFilterSelection';
import { stripAnsi } from './ansi';
import type { LogLineFields } from './logLineFormats';

/** Levels in severity order; the filter lists them in this order. */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The filter value for lines with no level of their own or to inherit. */
export const NO_LOG_LEVEL = '__no_level__';

// Labels match the Application Logs level filter.
const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  trace: 'Trace',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warning',
  error: 'Error',
  fatal: 'Fatal',
};

export const logLevelLabel = (value: string): string =>
  value === NO_LOG_LEVEL ? 'No level' : (LOG_LEVEL_LABELS[value as LogLevel] ?? value);

// Level names across logging libraries: zap, logrus, slog, log15, python, JUL,
// syslog/GCP severities, Serilog/.NET, and common abbreviations.
const LEVEL_ALIASES: Record<string, LogLevel> = {
  trace: 'trace',
  trc: 'trace',
  verbose: 'trace',
  vrb: 'trace',
  finest: 'trace',
  finer: 'trace',
  debug: 'debug',
  dbg: 'debug',
  dbug: 'debug',
  fine: 'debug',
  config: 'debug',
  info: 'info',
  inf: 'info',
  information: 'info',
  informational: 'info',
  notice: 'info',
  warn: 'warn',
  wrn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  eror: 'error',
  severe: 'error',
  fatal: 'fatal',
  ftl: 'fatal',
  critical: 'fatal',
  crit: 'fatal',
  alert: 'fatal',
  emerg: 'fatal',
  emergency: 'fatal',
  panic: 'fatal',
  dpanic: 'fatal',
};

// pino and bunyan write levels as numbers: 10 trace … 60 fatal.
const NUMERIC_LEVELS: readonly LogLevel[] = LOG_LEVELS;
const MIN_NUMERIC_LEVEL = 10;

/** The level a level field's value names ("warning", "INFO+2", 30, …), or null. */
export const logLevelOfValue = (value: unknown): LogLevel | null => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < MIN_NUMERIC_LEVEL) {
      return null;
    }
    const index = Math.min(Math.floor(value / 10) - 1, NUMERIC_LEVELS.length - 1);
    return NUMERIC_LEVELS[index] ?? null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  // slog offsets ("INFO+2") and postgres debug levels ("DEBUG1") keep their base level.
  const name = value
    .trim()
    .toLowerCase()
    .replace(/(?:[+-]\d+|\d)$/, '');
  return LEVEL_ALIASES[name] ?? null;
};

// Field names that hold a line's level, in the order they are preferred.
const LEVEL_FIELD_KEYS = [
  'level',
  'lvl',
  'severity',
  'log_level',
  'loglevel',
  'levelname',
  'log.level',
];
const LEVEL_FIELD_RANK = new Map(LEVEL_FIELD_KEYS.map((key, rank) => [key, rank]));

/** Whether a structured field holds the line's level (any letter case). */
export const isLevelFieldKey = (key: string): boolean => LEVEL_FIELD_RANK.has(key.toLowerCase());

const levelFromFields = (fields: LogLineFields): LogLevel | null => {
  let bestKey: string | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const key of Object.keys(fields)) {
    const rank = LEVEL_FIELD_RANK.get(key.toLowerCase());
    if (rank !== undefined && rank < bestRank) {
      bestKey = key;
      bestRank = rank;
    }
  }
  return bestKey === null ? null : logLevelOfValue(fields[bestKey]);
};

// A plain-text level must appear near the start, where log prefixes put it.
const PLAIN_TEXT_WINDOW = 100;
const LEVEL_WORDS =
  'trace|debug|info|notice|warn|warning|error|err|fatal|critical|crit|panic|severe|alert|emerg|emergency';
// [error], [WARN], apache's [core:warn]
const BRACKETED_LEVEL = new RegExp(String.raw`\[\s*(?:\w+:)?(${LEVEL_WORDS})\d?\s*\]`, 'i');
// level=warn inside a line that is not entirely logfmt
const LEVEL_PAIR = /\b(?:level|lvl|severity)=["']?([a-z]+)/i;
// Bare words only in capitals, so "info" or "errors" in prose never match.
const BARE_LEVEL =
  /\b(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|FATAL|CRITICAL|PANIC|SEVERE|ALERT|EMERG|EMERGENCY)\d?\b/;
const PLAIN_TEXT_PATTERNS = [BRACKETED_LEVEL, LEVEL_PAIR, BARE_LEVEL];

const levelFromPlainText = (line: string): LogLevel | null => {
  // Strip color codes from a bounded prefix; they do not count toward the window.
  const text = stripAnsi(line.slice(0, PLAIN_TEXT_WINDOW * 2)).slice(0, PLAIN_TEXT_WINDOW);
  let earliest: RegExpExecArray | null = null;
  for (const pattern of PLAIN_TEXT_PATTERNS) {
    const match = pattern.exec(text);
    if (match && (!earliest || match.index < earliest.index)) {
      earliest = match;
    }
  }
  return earliest ? logLevelOfValue(earliest[1]) : null;
};

/**
 * A line's own level: its level field when it is structured (a structured line
 * without one has none), otherwise a level word near the start of the text.
 */
export const detectLogLevel = (line: string, fields: LogLineFields | null): LogLevel | null =>
  fields ? levelFromFields(fields) : levelFromPlainText(line);

/** The levels the lines hold, and whether some lines have none. */
export type LogLevelSummary = { levels: LogLevel[]; hasUnleveled: boolean };

/**
 * Levels entries inherited in earlier passes. The buffer drops its oldest
 * lines, so a stack trace can outlive the error line it belongs to; recalling
 * the level it inherited keeps it with that error.
 */
export type InheritedLevelMemory<T> = {
  recall: (entry: T) => LogLevel | undefined;
  remember: (entry: T, level: LogLevel) => void;
};

const NO_MEMORY: InheritedLevelMemory<unknown> = {
  recall: () => undefined,
  remember: () => undefined,
};

// A level from an earlier line of the source in this pass wins (it may have
// arrived late, in time order); without one, the level the entry inherited
// before that line left the buffer.
const inheritLevel = <T>(
  entry: T,
  previous: LogLevel | undefined,
  memory: InheritedLevelMemory<T>
): LogLevel | null => {
  if (previous === undefined) {
    return memory.recall(entry) ?? null;
  }
  if (memory.recall(entry) !== previous) {
    memory.remember(entry, previous);
  }
  return previous;
};

/**
 * Each entry's level, in order: its own, else the last level seen from the same
 * source (a stack trace keeps its error line's level), else the level it
 * inherited in an earlier pass, else null.
 */
export const resolveLogLevels = <T>(
  entries: readonly T[],
  ownLevelOf: (entry: T, index: number) => LogLevel | null,
  sourceKeyOf: (entry: T, index: number) => string,
  memory: InheritedLevelMemory<T> = NO_MEMORY
): { levels: (LogLevel | null)[]; summary: LogLevelSummary } => {
  const lastBySource = new Map<string, LogLevel>();
  const found = new Set<LogLevel>();
  let hasUnleveled = false;
  const levels = entries.map((entry, index) => {
    const key = sourceKeyOf(entry, index);
    const level = ownLevelOf(entry, index) ?? inheritLevel(entry, lastBySource.get(key), memory);
    if (level) {
      lastBySource.set(key, level);
      found.add(level);
    } else {
      hasUnleveled = true;
    }
    return level;
  });
  return {
    levels,
    summary: { levels: LOG_LEVELS.filter((level) => found.has(level)), hasUnleveled },
  };
};

/** The marker a line shows for its level: debug, warnings, and errors (fatal included). */
export type LogLevelMarker = 'debug' | 'warn' | 'error';

const LEVEL_MARKERS: Partial<Record<LogLevel, LogLevelMarker>> = {
  debug: 'debug',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};

export const logLevelMarker = (level: LogLevel | null): LogLevelMarker | null =>
  level ? (LEVEL_MARKERS[level] ?? null) : null;

/** Tests a resolved level against the filter; null when every level is shown. */
export const logLevelMatcher = (
  selection: MultiSelectFilterSelection
): ((level: LogLevel | null) => boolean) | null => {
  if (selection.mode === 'all') {
    return null;
  }
  const chosen = new Set(filterSelectionValues(selection).map((value) => value.toLowerCase()));
  return (level) => chosen.has(level ?? NO_LOG_LEVEL);
};

/**
 * The filter's options: the levels present plus any chosen level the lines no
 * longer hold (so it can be unchecked), in severity order, then No level. No
 * options, and so no filter, while no line has a level.
 */
export const logLevelFilterOptions = (
  summary: LogLevelSummary,
  selection: MultiSelectFilterSelection
): DropdownOption[] => {
  const chosen = new Set(filterSelectionValues(selection).map((value) => value.toLowerCase()));
  const levels = LOG_LEVELS.filter((level) => summary.levels.includes(level) || chosen.has(level));
  const offerNoLevel = summary.hasUnleveled || chosen.has(NO_LOG_LEVEL);
  if (levels.length === 0 && !chosen.has(NO_LOG_LEVEL)) {
    return [];
  }
  const options = levels.map((level) => ({ value: level, label: LOG_LEVEL_LABELS[level] }));
  return offerNoLevel
    ? [...options, { value: NO_LOG_LEVEL, label: logLevelLabel(NO_LOG_LEVEL) }]
    : options;
};
