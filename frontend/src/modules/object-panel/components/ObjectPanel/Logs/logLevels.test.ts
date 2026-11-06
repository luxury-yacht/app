/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logLevels.test.ts
 *
 * Log level detection behind the Log Levels filter: which level a line has,
 * which level an unleveled line inherits, and which levels the filter offers.
 */

import { ALL_MULTISELECT_FILTER } from '@shared/components/dropdowns/multiSelectFilterSelection';
import { describe, expect, it } from 'vitest';
import {
  detectLogLevel,
  type LogLevel,
  logLevelFilterOptions,
  NO_LOG_LEVEL,
  resolveLogLevels,
} from './logLevels';

describe('detectLogLevel', () => {
  it('reads the level field of structured lines across logging libraries', () => {
    const levelOf = (fields: Record<string, unknown>) => detectLogLevel('', fields);
    expect(levelOf({ level: 'warning' })).toBe('warn'); // logrus, python
    expect(levelOf({ severity: 'CRITICAL' })).toBe('fatal'); // GCP
    expect(levelOf({ lvl: 'eror' })).toBe('error'); // log15
    expect(levelOf({ Level: 'Information' })).toBe('info'); // Serilog, .NET
    expect(levelOf({ 'log.level': 'debug' })).toBe('debug'); // ECS
    expect(levelOf({ levelname: 'WARNING' })).toBe('warn'); // python-json-logger
    expect(levelOf({ level: 'INFO+2' })).toBe('info'); // slog custom offsets
    expect(levelOf({ level: 'dpanic' })).toBe('fatal'); // zap
    expect(levelOf({ level: 'verbose' })).toBe('trace'); // Serilog
    expect(levelOf({ level: 30 })).toBe('info'); // pino/bunyan numbers
    expect(levelOf({ level: 50 })).toBe('error');
    expect(levelOf({ level: 'nonsense' })).toBeNull();
    // A structured line without a level field has none, whatever its message says.
    expect(detectLogLevel('{"msg":"ERROR in upstream"}', { msg: 'ERROR in upstream' })).toBeNull();
  });

  it('finds a level near the start of a plain-text line', () => {
    const levelOf = (line: string) => detectLogLevel(line, null);
    expect(levelOf('2026-11-06 12:00:00,123 ERROR [main] com.foo.Bar - failed')).toBe('error');
    expect(levelOf('2026/11/06 12:00:00 [error] 29#29: open() failed')).toBe('error'); // nginx
    expect(levelOf('[Fri Nov 06 12:00:00 2026] [core:warn] [pid 1] slow')).toBe('warn'); // apache
    expect(levelOf('12:00:00.000 [info] Running on port 4000')).toBe('info'); // elixir
    expect(levelOf('INFO:root:started')).toBe('info'); // python basicConfig
    expect(levelOf('2026-11-06 12:00:00 UTC [1] DEBUG1:  statement')).toBe('debug'); // postgres
    expect(levelOf('2026-11-06T12:00:00Z ts=1 level=warn msg="partial logfmt"')).toBe('warn');
    expect(levelOf('\u001b[31mERROR\u001b[0m disk full')).toBe('error');
  });

  it('leaves prose without a leading level unleveled', () => {
    const levelOf = (line: string) => detectLogLevel(line, null);
    expect(levelOf('all is fine, no info here')).toBeNull();
    expect(levelOf('Started worker; errors will be retried')).toBeNull();
    expect(levelOf(`${'x'.repeat(120)} ERROR late in the line`)).toBeNull();
  });
});

describe('resolveLogLevels', () => {
  type Line = { source: string; level: LogLevel | null };

  it('gives an unleveled line the level of the previous leveled line from its source', () => {
    const lines: Line[] = [
      { source: 'a', level: 'error' },
      { source: 'b', level: null }, // nothing before it in b
      { source: 'a', level: null }, // stack trace under a's error
      { source: 'b', level: 'info' },
      { source: 'b', level: null },
    ];
    const resolved = resolveLogLevels(
      lines,
      (line) => line.level,
      (line) => line.source
    );

    expect(resolved.levels).toEqual(['error', null, 'error', 'info', 'info']);
    expect(resolved.summary).toEqual({ levels: ['info', 'error'], hasUnleveled: true });
  });

  it('keeps an inherited level once the line it came from leaves the buffer', () => {
    const remembered = new Map<Line, LogLevel>();
    const memory = {
      recall: (line: Line) => remembered.get(line),
      remember: (line: Line, level: LogLevel) => remembered.set(line, level),
    };
    const resolve = (lines: Line[]) =>
      resolveLogLevels(
        lines,
        (line) => line.level,
        (line) => line.source,
        memory
      );
    const header: Line = { source: 'a', level: 'error' };
    const frame: Line = { source: 'a', level: null };
    const nextFrame: Line = { source: 'a', level: null };
    resolve([header, frame]);

    // The buffer dropped the header; a new frame arrives after the old one.
    const resolved = resolve([frame, nextFrame]);

    expect(resolved.levels).toEqual(['error', 'error']);
    expect(resolved.summary).toEqual({ levels: ['error'], hasUnleveled: false });
  });

  it('prefers a leveled line still in the buffer over a remembered level', () => {
    const remembered = new Map<Line, LogLevel>();
    const memory = {
      recall: (line: Line) => remembered.get(line),
      remember: (line: Line, level: LogLevel) => remembered.set(line, level),
    };
    const frame: Line = { source: 'a', level: null };
    resolveLogLevels(
      [{ source: 'a', level: 'error' }, frame],
      (line) => line.level,
      (line) => line.source,
      memory
    );

    // History arrives late: a warning that was written just before the frame.
    const resolved = resolveLogLevels(
      [{ source: 'a', level: 'warn' }, frame],
      (line) => line.level,
      (line) => line.source,
      memory
    );

    expect(resolved.levels).toEqual(['warn', 'warn']);
  });
});

describe('logLevelFilterOptions', () => {
  const values = (options: { value: string }[]) => options.map((option) => option.value);

  it('offers the levels present, in severity order, then No level', () => {
    expect(
      values(
        logLevelFilterOptions(
          { levels: ['debug', 'error'], hasUnleveled: true },
          ALL_MULTISELECT_FILTER
        )
      )
    ).toEqual(['debug', 'error', NO_LOG_LEVEL]);
  });

  it('keeps chosen levels the buffer no longer has, so they can be unchecked', () => {
    expect(
      values(
        logLevelFilterOptions(
          { levels: ['info'], hasUnleveled: false },
          { mode: 'some', values: ['fatal'] }
        )
      )
    ).toEqual(['info', 'fatal']);
  });

  it('offers nothing when no line has a level', () => {
    expect(
      logLevelFilterOptions({ levels: [], hasUnleveled: true }, ALL_MULTISELECT_FILTER)
    ).toEqual([]);
  });
});
