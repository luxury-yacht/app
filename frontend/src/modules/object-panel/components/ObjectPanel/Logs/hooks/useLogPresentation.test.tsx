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
import { initialLogOptionsState, type LogOptionsState } from '../logOptionsReducer';
import { buildParsedLogCsv, buildParsedLogDataColumns } from '../parsedLogColumns';
import { deriveParsedLogFieldKeys, formatParsedValue } from '../parsedLogUtils';
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

  const options = (overrides: Partial<LogOptionsState> = {}): LogOptionsState => ({
    ...initialLogOptionsState,
    ...overrides,
  });

  const csvFor = (parsed: ReturnType<typeof useLogPresentation>['parsedCandidates']) =>
    buildParsedLogCsv(
      parsed,
      buildParsedLogDataColumns(deriveParsedLogFieldKeys(parsed)),
      (entry, key) => formatParsedValue(entry.data[key])
    );

  it('presents node log lines: filter, parsed rows, and the parsed copy text', async () => {
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
    expect(result.parsedCandidates.map((entry) => entry.data)).toEqual([
      { level: 'info', msg: 'boot' },
      { level: 'error', msg: 'crash' },
    ]);
    expect(logCopyText('parsed', ['ignored'], csvFor(result.parsedCandidates))).toBe(
      'level,msg\ninfo,boot\nerror,crash'
    );
  });

  it('presents container entries: pod and container names match, metadata rides along', async () => {
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
    const result = await present({
      entries,
      options: options({ textFilter: 'WEB' }),
      searchTexts: (entry) => [entry.line, entry.pod, entry.container],
      lineOf: (entry) => entry.line,
      parsedMetadata: (entry) => ({ pod: entry.pod, container: entry.container, seq: entry._seq }),
    });

    expect(result.filteredEntries).toEqual([entries[0]]);
    expect(result.parsedCandidates).toEqual([
      {
        data: { msg: 'ready' },
        rawLine: '{"msg":"ready"}',
        lineNumber: 1,
        pod: 'web-1',
        container: 'app',
        seq: 1,
      },
    ]);
    expect(logCopyText('raw', ['[web-1/app] {"msg":"ready"}'], '')).toBe(
      '[web-1/app] {"msg":"ready"}'
    );
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
          options: options({ textFilter: 'error', inverseMatches: true }),
          searchTexts: (l) => [l],
          lineOf: (l) => l,
        })
      ).filteredEntries
    ).toEqual(['fine']);

    const invalid = await present({
      entries: lines,
      options: options({ textFilter: '(', regexMatches: true }),
      searchTexts: (l) => [l],
      lineOf: (l) => l,
    });
    expect(invalid.hasInvalidRegex).toBe(true);
    expect(invalid.filteredEntries).toEqual([]);
  });

  it('splits multi-line display lines into rows with stable keys', () => {
    expect(splitDisplayRows(['a\nb', 'c'], (index) => `line-${index}`)).toEqual([
      { key: 'line-0:0', line: 'a' },
      { key: 'line-0:1', line: 'b' },
      { key: 'line-1:0', line: 'c' },
    ]);
  });
});
