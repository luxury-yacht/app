/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogPresentation.test.tsx
 *
 * The presentation pipeline shared by Container Logs and Node Logs, with each
 * viewer's kind of lines.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContainerLogsEntry } from '@/core/refresh/types';
import { NO_LOG_LEVEL } from '../logLevels';
import {
  initialLogOptionsState,
  type LogOptionsState,
  type ParsedLogEntry,
} from '../logOptionsReducer';
import {
  type LogPresentationSource,
  logCopyText,
  splitDisplayRows,
  useLogPresentation,
} from './useLogPresentation';

describe('useLogPresentation', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const present = async <T,>(source: LogPresentationSource<T>) => {
    let result: ReturnType<typeof useLogPresentation<T>> | null = null;
    const Harness = () => {
      result = useLogPresentation(source);
      return null;
    };
    await act(async () => {
      root.render(<Harness />);
    });
    if (!result) {
      throw new Error('the hook did not render');
    }
    return result as ReturnType<typeof useLogPresentation<T>>;
  };

  // These cases filter, so they start in Filtered mode; the default, All, hides nothing.
  const options = (overrides: Partial<LogOptionsState> = {}): LogOptionsState => ({
    ...initialLogOptionsState,
    filterMode: 'filtered',
    ...overrides,
  });

  it('presents node log lines: filter, table rows, and the table CSV', async () => {
    const lines = [
      '{"level":"info","msg":"boot"}',
      'plain text',
      '{"level":"error","msg":"crash"}',
    ];
    const result = await present({
      entries: lines,
      options: options({ textFilter: 'level', displayMode: 'parsed' }),
      searchTexts: (line) => [line],
      lineOf: (line) => line,
    });

    expect(result.filteredEntries).toEqual([lines[0], lines[2]]);
    expect(result.parsedRows.map((entry) => entry.data)).toEqual([
      { level: 'info', msg: 'boot' },
      { level: 'error', msg: 'crash' },
    ]);
    expect(result.tableColumns.map((column) => column.key)).toEqual(['level', 'msg']);
    expect(logCopyText('parsed', () => 'ignored', result.getParsedCsv)).toBe(
      'level,msg\ninfo,boot\nerror,crash'
    );
  });

  it('presents container entries: names match, metadata columns lead the table', async () => {
    const entries: ContainerLogsEntry[] = [
      {
        _seq: 1,
        pod: 'web-1',
        container: 'app',
        line: '{"msg":"ready"}',
        timestamp: 't1',
        isInit: false,
      },
      {
        _seq: 2,
        pod: 'worker-1',
        container: 'jobs',
        line: 'unrelated',
        timestamp: 't2',
        isInit: false,
      },
    ];
    const podColumn = { key: 'pod', header: 'pod', render: (row: ParsedLogEntry) => row.pod };
    const result = await present({
      entries,
      options: options({ textFilter: 'WEB', displayMode: 'parsed' }),
      searchTexts: (entry) => [entry.line, entry.pod, entry.container],
      lineOf: (entry) => entry.line,
      parsedMetadata: (entry) => ({ pod: entry.pod, container: entry.container, seq: entry._seq }),
      metadataColumns: [podColumn],
      exportValue: (row, key) => (key === 'pod' ? (row.pod ?? '') : String(row.data[key])),
    });

    expect(result.filteredEntries).toEqual([entries[0]]);
    expect(result.tableColumns.map((column) => column.key)).toEqual(['pod', 'msg']);
    expect(result.getParsedCsv()).toBe('pod,msg\nweb-1,ready');
    expect(result.parsedRows).toEqual([
      {
        data: { msg: 'ready' },
        rawLine: '{"msg":"ready"}',
        lineNumber: 1,
        pod: 'web-1',
        container: 'app',
        seq: 1,
      },
    ]);
    expect(
      logCopyText(
        'raw',
        () => '[web-1/app] {"msg":"ready"}',
        () => ''
      )
    ).toBe('[web-1/app] {"msg":"ready"}');
  });

  it('builds no table outside the table view, but still reports parseable lines', async () => {
    const result = await present({
      entries: ['{"msg":"ready"}'],
      options: options(),
      searchTexts: (line) => [line],
      lineOf: (line) => line,
    });

    expect(result.canParseLogs).toBe(true);
    expect(result.parsedRows).toEqual([]);
    expect(result.getParsedCsv()).toBe('');
  });

  it('inverts, respects case, and reports an invalid regex', async () => {
    const lines = ['Error one', 'error two', 'fine'];
    expect(
      (
        await present({
          entries: lines,
          options: options({ textFilter: 'Error', caseSensitiveMatches: true }),
          searchTexts: (l) => [l],
          lineOf: (l) => l,
        })
      ).filteredEntries
    ).toEqual(['Error one']);
    expect(
      (
        await present({
          entries: lines,
          options: options({ textFilter: 'error', filterMode: 'invert' }),
          searchTexts: (l) => [l],
          lineOf: (l) => l,
        })
      ).filteredEntries
    ).toEqual(['fine']);
    // All mode hides nothing; an invalid pattern is still reported without emptying the view.
    const all = await present({
      entries: lines,
      options: options({ textFilter: '(', regexMatches: true, filterMode: 'all' }),
      searchTexts: (l) => [l],
      lineOf: (l) => l,
    });
    expect(all.filteredEntries).toEqual(lines);
    expect(all.hasInvalidRegex).toBe(true);

    const invalid = await present({
      entries: lines,
      options: options({ textFilter: '(', regexMatches: true }),
      searchTexts: (l) => [l],
      lineOf: (l) => l,
    });
    expect(invalid.hasInvalidRegex).toBe(true);
    expect(invalid.filteredEntries).toEqual([]);
  });

  it('reads logfmt and klog lines into the table like JSON', async () => {
    const lines = [
      'level=info msg="cache warmed" keys=12',
      'I1106 12:00:00.000001       1 sync.go:7] "Synced" kind="Pod"',
      'plain text',
    ];
    const result = await present({
      entries: lines,
      options: options({ displayMode: 'parsed' }),
      searchTexts: (line) => [line],
      lineOf: (line) => line,
    });

    expect(result.canParseLogs).toBe(true);
    expect(result.parsedRows.map((row) => row.data)).toEqual([
      { level: 'info', msg: 'cache warmed', keys: '12' },
      {
        level: 'info',
        time: '1106 12:00:00.000001',
        thread: '1',
        caller: 'sync.go:7',
        msg: 'Synced',
        kind: 'Pod',
      },
    ]);
  });

  describe('level filter', () => {
    const entry = (seq: number, containerName: string, line: string): ContainerLogsEntry => ({
      _seq: seq,
      pod: 'web-1',
      container: containerName,
      line,
      timestamp: `t${seq}`,
      isInit: false,
    });
    // Two containers interleave; each line's level comes from its own container.
    const entries = [
      entry(1, 'app', 'starting'),
      entry(2, 'app', '{"level":"error","msg":"crash"}'),
      entry(3, 'sidecar', 'plain sidecar output'),
      entry(4, 'app', '    at Server.listen (server.js:10)'),
      entry(5, 'sidecar', 'level=info msg=ready'),
      entry(6, 'app', 'level=debug msg="retrying"'),
    ];
    const presentLevels = (overrides: Partial<LogOptionsState>) =>
      present({
        entries,
        options: options(overrides),
        searchTexts: (e) => [e.line],
        lineOf: (e) => e.line,
        sourceKeyOf: (e) => `${e.pod}/${e.container}`,
      });
    const seqs = (shown: ContainerLogsEntry[]) => shown.map((e) => e._seq);

    it('lists the levels found, and shows every line until levels are chosen', async () => {
      const result = await presentLevels({});

      expect(result.logLevels).toEqual({ levels: ['debug', 'info', 'error'], hasUnleveled: true });
      expect(seqs(result.filteredEntries)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(result.levelFilterHidesLines).toBe(false);
    });

    it('keeps a stack trace with its error line', async () => {
      const result = await presentLevels({ levelFilter: { mode: 'some', values: ['error'] } });

      expect(seqs(result.filteredEntries)).toEqual([2, 4]);
      expect(result.levelFilterHidesLines).toBe(true);
    });

    it('chooses lines with nothing to inherit as No level', async () => {
      const result = await presentLevels({ levelFilter: { mode: 'some', values: [NO_LOG_LEVEL] } });

      expect(seqs(result.filteredEntries)).toEqual([1, 3]);
    });

    it('resolves levels before the text filter hides the line they come from', async () => {
      const result = await presentLevels({
        levelFilter: { mode: 'some', values: ['error'] },
        textFilter: 'Server.listen',
      });

      expect(seqs(result.filteredEntries)).toEqual([4]);
    });

    it('shows nothing when no level is chosen', async () => {
      const result = await presentLevels({ levelFilter: { mode: 'none' } });

      expect(result.filteredEntries).toEqual([]);
    });
  });

  it('splits multi-line display lines into rows with stable keys', () => {
    expect(splitDisplayRows(['a\nb', 'c'], (index) => `line-${index}`)).toEqual([
      { key: 'line-0:0', line: 'a' },
      { key: 'line-0:1', line: 'b' },
      { key: 'line-1:0', line: 'c' },
    ]);
  });
});
