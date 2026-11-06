/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogPresentation.ts
 *
 * The presentation pipeline shared by Container Logs and Node Logs: structured
 * line detection (JSON, klog, logfmt) and log levels, the level filter, a
 * deferred text filter, the parsed table (rows, columns, CSV), display rows and
 * the text the copy action writes. Each viewer supplies its kind of line
 * through accessors and keeps its own source filters and line formatting;
 * Container Logs adds metadata columns to the table.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { type Dispatch, useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { stripAnsi } from '../ansi';
import {
  detectLogLevel,
  type LogLevel,
  type LogLevelSummary,
  logLevelMatcher,
  resolveLogLevels,
} from '../logLevels';
import { type LogLineFields, parseStructuredLogLine } from '../logLineFormats';
import type { LogOptionsAction, LogOptionsState, ParsedLogEntry } from '../logOptionsReducer';
import { buildLogSearchRegex } from '../logSearch';
import { buildParsedLogCsv, buildParsedLogDataColumns } from '../parsedLogColumns';
import { deriveParsedLogFieldKeys, formatParsedValue } from '../parsedLogUtils';
import type { RenderedLogRow } from '../RawLogViewer';

export type LogPresentationSource<T> = {
  entries: T[];
  options: Pick<
    LogOptionsState,
    | 'textFilter'
    | 'filterMode'
    | 'caseSensitiveMatches'
    | 'regexMatches'
    | 'displayMode'
    | 'levelFilter'
  >;
  /** The texts the filter matches for an entry; any match keeps it. */
  searchTexts: (entry: T) => string[];
  /** The log line the entry carries, used for structured and level detection. */
  lineOf: (entry: T) => string;
  /**
   * Which source wrote the entry (Container Logs: pod and container). An
   * unleveled line inherits the last level from its own source; without this
   * every entry shares one source.
   */
  sourceKeyOf?: (entry: T) => string;
  /** Metadata copied onto an entry's parsed-table row. */
  parsedMetadata?: (entry: T) => Omit<ParsedLogEntry, 'data' | 'rawLine' | 'lineNumber'>;
  /** Table columns shown before the JSON fields (Container Logs: pod, container, time). */
  metadataColumns?: GridColumnDefinition<ParsedLogEntry>[];
  /** How a table cell is written to CSV; defaults to the JSON field's value. */
  exportValue?: (row: ParsedLogEntry, key: string) => string;
};

export type LogPresentation<T> = {
  /** The text filter as applied; it trails typing so large buffers stay responsive. */
  filterText: string;
  filteredEntries: T[];
  /** At least one shown line has text. */
  hasVisibleLines: boolean;
  /** At least one shown line is structured (JSON, klog, logfmt), so Pretty and Table are available. */
  canParseLogs: boolean;
  hasInvalidRegex: boolean;
  /** Whether the text filter hides lines: it is set, and the mode is not All. */
  textFilterHidesLines: boolean;
  /** The levels the entries hold, before the level and text filters. */
  logLevels: LogLevelSummary;
  /** Whether the level filter narrows the lines: not every level is chosen. */
  levelFilterHidesLines: boolean;
  /** Matches to highlight in the shown lines; none in Invert, which shows the others. */
  highlightRegex: RegExp | null;
  /** The parsed JSON table, only in the table view: rows and columns. */
  parsedRows: ParsedLogEntry[];
  tableColumns: GridColumnDefinition<ParsedLogEntry>[];
  /** The table as CSV, built when asked for (the copy action). */
  getParsedCsv: () => string;
  /**
   * An entry's line read as fields (a JSON object, klog, or logfmt), or null;
   * cached per line. Pretty shows the fields as JSON.
   */
  jsonOf: (entry: T) => LogLineFields | null;
};

const NO_PARSED_ROWS: ParsedLogEntry[] = [];
const NO_COLUMNS: GridColumnDefinition<ParsedLogEntry>[] = [];

const jsonFieldValue = (row: ParsedLogEntry, key: string): string =>
  formatParsedValue(row.data[key]);

// Metadata columns lead; JSON fields follow, skipping any key a metadata column
// already shows. Without JSON fields there is no table.
const buildTableColumns = (
  parsedRows: ParsedLogEntry[],
  metadataColumns: GridColumnDefinition<ParsedLogEntry>[]
): GridColumnDefinition<ParsedLogEntry>[] => {
  const fieldKeys = deriveParsedLogFieldKeys(parsedRows);
  if (fieldKeys.length === 0) {
    return NO_COLUMNS;
  }
  return metadataColumns.concat(
    buildParsedLogDataColumns(fieldKeys, new Set(metadataColumns.map((column) => column.key)))
  );
};

// Filters on the deferred text so typing stays responsive on large buffers. In
// All mode the text only finds matches (the viewer highlights them); no line is hidden.
const useTextFilter = <T>({
  entries,
  options,
  searchTexts,
}: LogPresentationSource<T>): {
  filterText: string;
  filteredEntries: T[];
  hasInvalidRegex: boolean;
} => {
  const textFilter = useDeferredValue(options.textFilter);
  const { filterMode, caseSensitiveMatches, regexMatches } = options;
  return useMemo(() => {
    if (!textFilter.trim()) {
      return { filterText: textFilter, filteredEntries: entries, hasInvalidRegex: false };
    }
    const regex = regexMatches
      ? buildLogSearchRegex(textFilter, { regexMode: true, caseSensitive: caseSensitiveMatches })
      : null;
    if (filterMode === 'all') {
      return {
        filterText: textFilter,
        filteredEntries: entries,
        hasInvalidRegex: regexMatches && !regex,
      };
    }
    if (regexMatches && !regex) {
      return { filterText: textFilter, filteredEntries: [], hasInvalidRegex: true };
    }
    const needle = caseSensitiveMatches ? textFilter : textFilter.toLowerCase();
    const matches = (text: string): boolean => {
      const plain = stripAnsi(text);
      if (regex) {
        return regex.test(plain);
      }
      return (caseSensitiveMatches ? plain : plain.toLowerCase()).includes(needle);
    };
    return {
      filterText: textFilter,
      filteredEntries: entries.filter(
        (entry) => searchTexts(entry).some(matches) !== (filterMode === 'invert')
      ),
      hasInvalidRegex: false,
    };
  }, [caseSensitiveMatches, entries, filterMode, regexMatches, searchTexts, textFilter]);
};

// A line's fields when it is structured, its own level (before inheritance),
// and the source that wrote it. All three are fixed per entry, so they are
// worked out once and reused by every batch.
type LineAnalysis = { fields: LogLineFields | null; level: LogLevel | null; source: string };

const analyzeLine = (line: string, source: string): LineAnalysis => {
  const fields = parseStructuredLogLine(line);
  return { fields, level: detectLogLevel(line, fields), source };
};

type LineAccessors<T> = {
  lineOf: (entry: T) => string;
  sourceKeyOf: (entry: T) => string;
};

const analyzeObjectEntry = <T>(
  cache: WeakMap<object, LineAnalysis>,
  entry: T & object,
  { lineOf, sourceKeyOf }: LineAccessors<T>
): LineAnalysis => {
  let analysis = cache.get(entry);
  if (!analysis) {
    analysis = analyzeLine(lineOf(entry), sourceKeyOf(entry));
    cache.set(entry, analysis);
  }
  return analysis;
};

const analyzeStringLine = <T>(
  previous: Map<string, LineAnalysis>,
  next: Map<string, LineAnalysis>,
  entry: T,
  { lineOf, sourceKeyOf }: LineAccessors<T>
): LineAnalysis => {
  const line = lineOf(entry);
  const analysis = previous.get(line) ?? analyzeLine(line, sourceKeyOf(entry));
  next.set(line, analysis);
  return analysis;
};

const ONE_SOURCE = (): string => '';

// Line analysis is cached per line: entry objects by identity, plain string
// lines by value (keeping only the latest entries' lines). jsonOf reads the
// same cache, so the structured views format each line without parsing it again.
const useLineAnalysis = <T>(lineOf: (entry: T) => string, sourceKeyOf: (entry: T) => string) => {
  const objectCache = useRef(new WeakMap<object, LineAnalysis>());
  const stringCache = useRef(new Map<string, LineAnalysis>());
  const accessors = useMemo(() => ({ lineOf, sourceKeyOf }), [lineOf, sourceKeyOf]);
  const analyzeAll = useCallback(
    (entries: T[]): LineAnalysis[] => {
      const nextStrings = new Map<string, LineAnalysis>();
      const analyses = entries.map((entry) =>
        typeof entry === 'object' && entry !== null
          ? analyzeObjectEntry(objectCache.current, entry, accessors)
          : analyzeStringLine(stringCache.current, nextStrings, entry, accessors)
      );
      stringCache.current = nextStrings;
      return analyses;
    },
    [accessors]
  );
  const jsonOf = useCallback(
    (entry: T): LogLineFields | null => {
      if (typeof entry === 'object' && entry !== null) {
        return analyzeObjectEntry(objectCache.current, entry, accessors).fields;
      }
      const line = accessors.lineOf(entry);
      return (stringCache.current.get(line) ?? analyzeLine(line, accessors.sourceKeyOf(entry)))
        .fields;
    },
    [accessors]
  );
  return { analyzeAll, jsonOf };
};

const levelOfAnalysis = (analysis: LineAnalysis) => analysis.level;
const sourceOfAnalysis = (analysis: LineAnalysis) => analysis.source;
const hasFields = (analysis: LineAnalysis) => analysis.fields !== null;

// Levels resolve over every entry before any filter, so a line keeps the level
// it inherits even when the line it inherits from is filtered out.
const useLevelFilter = <T>(
  entries: T[],
  analyses: LineAnalysis[],
  levelFilter: LogOptionsState['levelFilter']
) => {
  const { levels, summary } = useMemo(
    () => resolveLogLevels(analyses, levelOfAnalysis, sourceOfAnalysis),
    [analyses]
  );
  const matcher = useMemo(() => logLevelMatcher(levelFilter), [levelFilter]);
  const levelEntries = useMemo(
    () => (matcher ? entries.filter((_, index) => matcher(levels[index] ?? null)) : entries),
    [entries, levels, matcher]
  );
  return { levelEntries, logLevels: summary, levelFilterHidesLines: matcher !== null };
};

export function useLogPresentation<T>(source: LogPresentationSource<T>): LogPresentation<T> {
  const {
    entries,
    lineOf,
    sourceKeyOf = ONE_SOURCE,
    parsedMetadata,
    metadataColumns = NO_COLUMNS,
    exportValue = jsonFieldValue,
  } = source;
  const { displayMode, filterMode, regexMatches, caseSensitiveMatches, levelFilter } =
    source.options;
  const { analyzeAll, jsonOf } = useLineAnalysis(lineOf, sourceKeyOf);
  const analyses = useMemo(() => analyzeAll(entries), [analyzeAll, entries]);
  const { levelEntries, logLevels, levelFilterHidesLines } = useLevelFilter(
    entries,
    analyses,
    levelFilter
  );
  const { filterText, filteredEntries, hasInvalidRegex } = useTextFilter({
    ...source,
    entries: levelEntries,
  });
  const isParsedView = displayMode === 'parsed';
  // Highlighting follows the filter as applied, so it never runs ahead of it.
  const highlightRegex = useMemo(
    () =>
      filterMode === 'invert'
        ? null
        : buildLogSearchRegex(filterText, {
            regexMode: regexMatches,
            caseSensitive: caseSensitiveMatches,
            global: true,
          }),
    [caseSensitiveMatches, filterMode, filterText, regexMatches]
  );
  // Table rows are built only for the table view.
  const parsedRows = useMemo<ParsedLogEntry[]>(() => {
    if (!isParsedView) {
      return NO_PARSED_ROWS;
    }
    return filteredEntries.flatMap((entry, index) => {
      const data = jsonOf(entry);
      if (!data) {
        return [];
      }
      return [
        {
          data,
          rawLine: stripAnsi(lineOf(entry)),
          lineNumber: index + 1,
          ...parsedMetadata?.(entry),
        },
      ];
    });
  }, [filteredEntries, isParsedView, jsonOf, lineOf, parsedMetadata]);
  // Unfiltered, the analyses already line up with the shown entries.
  const canParseLogs = useMemo(
    () =>
      filteredEntries === entries
        ? analyses.some(hasFields)
        : filteredEntries.some((entry) => jsonOf(entry) !== null),
    [analyses, entries, filteredEntries, jsonOf]
  );
  const tableColumns = useMemo(
    () => (isParsedView ? buildTableColumns(parsedRows, metadataColumns) : NO_COLUMNS),
    [isParsedView, metadataColumns, parsedRows]
  );
  const getParsedCsv = useCallback(
    () => (isParsedView ? buildParsedLogCsv(parsedRows, tableColumns, exportValue) : ''),
    [exportValue, isParsedView, parsedRows, tableColumns]
  );
  const hasVisibleLines = useMemo(
    () => filteredEntries.some((entry) => lineOf(entry).trim().length > 0),
    [filteredEntries, lineOf]
  );

  return {
    filterText,
    filteredEntries,
    hasVisibleLines,
    canParseLogs,
    hasInvalidRegex,
    textFilterHidesLines: filterMode !== 'all' && filterText.trim().length > 0,
    logLevels,
    levelFilterHidesLines,
    highlightRegex,
    parsedRows,
    tableColumns,
    getParsedCsv,
    jsonOf,
  };
}

/**
 * Switches the JSON views back to raw once lines are shown and none of them is
 * JSON. An empty log (reconnecting, switching to previous logs) keeps the view.
 */
export function useRawViewFallback({
  displayMode,
  hasVisibleLines,
  canParseLogs,
  dispatch,
}: {
  displayMode: LogOptionsState['displayMode'];
  hasVisibleLines: boolean;
  canParseLogs: boolean;
  dispatch: Dispatch<LogOptionsAction>;
}): void {
  useEffect(() => {
    if (displayMode !== 'raw' && hasVisibleLines && !canParseLogs) {
      dispatch({ type: 'SET_DISPLAY_MODE', payload: 'raw' });
    }
  }, [canParseLogs, dispatch, displayMode, hasVisibleLines]);
}

/** Splits display lines that contain line breaks into rendered rows. */
export const splitDisplayRows = (
  displayLines: string[],
  keyFor: (displayIndex: number) => string
): RenderedLogRow[] =>
  displayLines.flatMap((line, displayIndex) =>
    line.split('\n').map((segment, segmentIndex) => ({
      key: `${keyFor(displayIndex)}:${segmentIndex}`,
      line: segment,
    }))
  );

/**
 * The text the copy action writes: the parsed table as CSV, or the shown lines.
 * Both are built only when copying.
 */
export const logCopyText = (
  displayMode: LogOptionsState['displayMode'],
  lineText: () => string,
  csv: () => string
): string => (displayMode === 'parsed' ? csv() : lineText());
