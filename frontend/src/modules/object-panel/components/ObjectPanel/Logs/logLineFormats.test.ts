/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logLineFormats.test.ts
 *
 * The structured line formats the Pretty and Table views read: JSON objects,
 * klog, and logfmt. A line that is none of them must stay plain text.
 */

import { describe, expect, it } from 'vitest';
import { parseStructuredLogLine } from './logLineFormats';

describe('parseStructuredLogLine', () => {
  it('parses non-empty JSON objects and rejects other JSON shapes', () => {
    expect(parseStructuredLogLine('{"level":"info"}')).toEqual({ level: 'info' });
    expect(parseStructuredLogLine('[]')).toBeNull();
    expect(parseStructuredLogLine('{}')).toBeNull();
    // An object may follow whitespace or sit inside ANSI color codes.
    expect(parseStructuredLogLine('  {"a":1}')).toEqual({ a: 1 });
    expect(parseStructuredLogLine('\u001b[32m{"a":1}\u001b[0m')).toEqual({ a: 1 });
    expect(parseStructuredLogLine('42')).toBeNull();
    expect(parseStructuredLogLine('"text"')).toBeNull();
    expect(parseStructuredLogLine('{"a":1} trailing')).toBeNull();
  });

  it('parses logfmt pairs, unquoting quoted values', () => {
    expect(
      parseStructuredLogLine(
        'time=2026-11-06T12:00:00Z level=info msg="sync done \\"ok\\"" items=42 empty= caller=main.go:42'
      )
    ).toEqual({
      time: '2026-11-06T12:00:00Z',
      level: 'info',
      msg: 'sync done "ok"',
      items: '42',
      empty: '',
      caller: 'main.go:42',
    });
    // logrus and slog text output, with dotted keys.
    expect(parseStructuredLogLine('level=WARN http.method=GET msg="slow request"')).toEqual({
      level: 'WARN',
      'http.method': 'GET',
      msg: 'slow request',
    });
  });

  it('keeps prose with an occasional key=value as plain text', () => {
    expect(parseStructuredLogLine('connecting to host=db')).toBeNull();
    expect(parseStructuredLogLine('retries=3')).toBeNull();
    expect(parseStructuredLogLine('level=info msg="unterminated')).toBeNull();
    expect(parseStructuredLogLine('level=info stray-word')).toBeNull();
    expect(parseStructuredLogLine('a="b"c d=e')).toBeNull();
    expect(parseStructuredLogLine('plain text')).toBeNull();
  });

  it('parses a klog header and its structured key/value pairs', () => {
    expect(
      parseStructuredLogLine(
        'I1106 12:00:00.123456       1 controller.go:88] "Reconciling" pod="default/web" attempt=3'
      )
    ).toEqual({
      level: 'info',
      time: '1106 12:00:00.123456',
      thread: '1',
      caller: 'controller.go:88',
      msg: 'Reconciling',
      pod: 'default/web',
      attempt: '3',
    });
  });

  it('maps every klog severity letter to a level', () => {
    const levelOf = (letter: string) =>
      parseStructuredLogLine(`${letter}1106 12:00:00.000001   42 main.go:1] message`)?.level;
    expect(['I', 'W', 'E', 'F'].map(levelOf)).toEqual(['info', 'warn', 'error', 'fatal']);
  });

  it('keeps a klog message whole when it is not a quoted structured message', () => {
    expect(
      parseStructuredLogLine('E1106 12:00:00.000001   42 server.go:9] listen tcp :80: bind failed')
    ).toEqual({
      level: 'error',
      time: '1106 12:00:00.000001',
      thread: '42',
      caller: 'server.go:9',
      msg: 'listen tcp :80: bind failed',
    });
    // A structured tail that does not split into pairs stays part of the message.
    expect(
      parseStructuredLogLine('I1106 12:00:00.000001   42 a.go:1] "Synced" obj={Name:a Namespace:b}')
        ?.msg
    ).toBe('"Synced" obj={Name:a Namespace:b}');
    // A pair named like a header field never replaces the header.
    expect(
      parseStructuredLogLine('W1106 12:00:00.000001   42 a.go:1] "Slow" level=debug')?.level
    ).toBe('warn');
  });
});
