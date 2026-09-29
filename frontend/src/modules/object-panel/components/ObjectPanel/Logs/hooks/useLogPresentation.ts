/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogPresentation.ts
 *
 * The presentation pipeline shared by Container Logs and Node Logs: a deferred
 * text filter, JSON detection, the parsed JSON table (rows, columns, CSV),
 * display rows and the text the copy action writes. Each viewer supplies its
 * kind of line through accessors and keeps its own source filters and line
 * formatting; Container Logs adds metadata columns to the table.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { type Dispatch, useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { stripAnsi } from '../ansi';
import type { LogOptionsAction, LogOptionsState, ParsedLogEntry } from '../logOptionsReducer';
import { buildLogSearchRegex } from '../logSearch';
import { buildParsedLogCsv, buildParsedLogDataColumns } from '../parsedLogColumns';
import { deriveParsedLogFieldKeys, formatParsedValue, tryParseJSONObject } from '../parsedLogUtils';
import type { RenderedLogRow } from '../RawLogViewer';

export type LogPresentationSource<T> = {
  entries: T[];
  options: Pick<
    LogOptionsState,
    'textFilter' | 'inverseMatches' | 'caseSensitiveMatches' | 'regexMatches' | 'displayMode'
  >;
  /** The texts the filter matches for an entry; any match keeps it. */
  searchTexts: (entry: T) => string[];
  /** The log line the entry carries, used for JSON detection. */
  lineOf: (entry: T) => string;
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
  /** At least one shown line is a JSON object, so the JSON views are available. */
  canParseLogs: boolean;
  hasInvalidRegex: boolean;
  /** The parsed JSON table: rows (only in the table view), columns and its CSV. */
  parsedRows: ParsedLogEntry[];
  tableColumns: GridColumnDefinition<ParsedLogEntry>[];
  parsedCsv: string;
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

type JsonObject = Record<string, unknown> | null;

// Filters on the deferred text so typing stays responsive on large buffers.
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
  const { inverseMatches, caseSensitiveMatches, regexMatches } = options;
  return useMemo(() => {
    if (!textFilter.trim()) {
      return { filterText: textFilter, filteredEntries: entries, hasInvalidRegex: false };
    }
    const regex = regexMatches
      ? buildLogSearchRegex(textFilter, { regexMode: true, caseSensitive: caseSensitiveMatches })
      : null;
    if (regexMatches && !regex) {
      return { filterText: textFilter, filteredEntries: [], hasInvalidRegex: true };
    }
    const needle = caseSensitiveMatches ? textFilter : textFilter.toLowerCase();
    const matches = (text: string): boolean => {
      const plain = stripAnsi(text);
      return regex
        ? regex.test(plain)
        : (caseSensitiveMatches ? plain : plain.toLowerCase()).includes(needle);
    };
    return {
      filterText: textFilter,
      filteredEntries: entries.filter(
        (entry) => searchTexts(entry).some(matches) !== inverseMatches
      ),
      hasInvalidRegex: false,
    };
  }, [caseSensitiveMatches, entries, inverseMatches, regexMatches, searchTexts, textFilter]);
};

const detectObjectLine = (
  cache: WeakMap<object, JsonObject>,
  entry: object,
  line: () => string
): JsonObject => {
  if (!cache.has(entry)) {
    cache.set(entry, tryParseJSONObject(line()));
  }
  return cache.get(entry) ?? null;
};

const detectStringLine = (
  previous: Map<string, JsonObject>,
  next: Map<string, JsonObject>,
  line: string
): JsonObject => {
  const detected = previous.has(line) ? (previous.get(line) ?? null) : tryParseJSONObject(line);
  next.set(line, detected);
  return detected;
};

// JSON detection is cached per line: entry objects by identity, plain string
// lines by value (keeping only the lines currently shown).
const useJsonDetection = <T>(lineOf: (entry: T) => string) => {
  const objectCache = useRef(new WeakMap<object, JsonObject>());
  const stringCache = useRef(new Map<string, JsonObject>());
  return useCallback(
    (entries: T[]): JsonObject[] => {
      const nextStrings = new Map<string, JsonObject>();
      const detected = entries.map((entry) =>
        typeof entry === 'object' && entry !== null
          ? detectObjectLine(objectCache.current, entry, () => lineOf(entry))
          : detectStringLine(stringCache.current, nextStrings, lineOf(entry))
      );
      stringCache.current = nextStrings;
      return detected;
    },
    [lineOf]
  );
};

export function useLogPresentation<T>(source: LogPresentationSource<T>): LogPresentation<T> {
  const { filterText, filteredEntries, hasInvalidRegex } = useTextFilter(source);
  const {
    lineOf,
    parsedMetadata,
    metadataColumns = NO_COLUMNS,
    exportValue = jsonFieldValue,
  } = source;
  const isParsedView = source.options.displayMode === 'parsed';
  const detectJson = useJsonDetection(lineOf);
  const parsedCandidates = useMemo<ParsedLogEntry[]>(() => {
    const detected = detectJson(filteredEntries);
    return filteredEntries.flatMap((entry, index) => {
      const data = detected[index];
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
  }, [detectJson, filteredEntries, lineOf, parsedMetadata]);
  const parsedRows = isParsedView ? parsedCandidates : NO_PARSED_ROWS;
  const tableColumns = useMemo(
    () => (isParsedView ? buildTableColumns(parsedRows, metadataColumns) : NO_COLUMNS),
    [isParsedView, metadataColumns, parsedRows]
  );
  const parsedCsv = useMemo(
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
    canParseLogs: parsedCandidates.length > 0,
    hasInvalidRegex,
    parsedRows,
    tableColumns,
    parsedCsv,
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

/** The text the copy action writes: the parsed table as CSV, or the shown lines. */
export const logCopyText = (
  displayMode: LogOptionsState['displayMode'],
  displayLines: string[],
  parsedCsv: string
): string => (displayMode === 'parsed' ? parsedCsv : displayLines.join('\n'));
