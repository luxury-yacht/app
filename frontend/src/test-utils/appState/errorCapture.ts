/**
 * frontend/src/test-utils/appState/errorCapture.ts
 *
 * Records every path the app reports a failure through, so an unexpected
 * failure fails the test instead of passing silently:
 * - errorHandler.handle / handleInline / handleOperational / warn (the
 *   lint-enforced reporting chokepoint; only `handle` and `warn` notify
 *   toast listeners);
 * - event-bus handler exceptions, through the handler reporter;
 * - React root caught, uncaught, and recoverable render errors.
 */

import type { RootOptions } from 'react-dom/client';
import { vi } from 'vitest';
import { eventBus } from '@/core/events';
import { errorHandler } from '@/utils/errorHandler';

export type CapturedErrorKind =
  | 'toast'
  | 'warning'
  | 'inline'
  | 'operational'
  | 'expected-denial'
  | 'event-bus'
  | 'render-caught'
  | 'render-uncaught'
  | 'recoverable';

export interface CapturedError {
  /** Every path the same error object was reported through, in order. */
  kinds: CapturedErrorKind[];
  error: unknown;
  context?: Record<string, unknown>;
}

export interface ErrorCapture {
  rootOptions: RootOptions;
  records(): CapturedError[];
  /** Removes and returns the records `match` accepts; the test has handled them. */
  take(match: (record: CapturedError) => boolean): CapturedError[];
  /**
   * Throws when a record other than an expected denial was neither taken nor
   * expected. The harness calls this after every test.
   */
  assertNoneUnexpected(): void;
  restore(): void;
}

type HandlerReporter = Parameters<typeof eventBus.setHandlerErrorReporter>[0];

const describe = (record: CapturedError): string => {
  const message = record.error instanceof Error ? record.error.message : String(record.error);
  return `${record.kinds.join('+')}: ${message}`;
};

export const installErrorCapture = (): ErrorCapture => {
  let captured: CapturedError[] = [];

  const record = (kind: CapturedErrorKind, error: unknown, context?: Record<string, unknown>) => {
    const existing =
      typeof error === 'object' && error !== null
        ? captured.find((entry) => entry.error === error)
        : undefined;
    if (existing) {
      existing.kinds.push(kind);
      return;
    }
    captured.push({ kinds: [kind], error, context });
  };

  // handle() notifies toast listeners unless it suppressed an expected denial;
  // a call with no notification is that denial. The harness does not
  // re-implement the suppression rule.
  let notified = false;
  const unsubscribe = errorHandler.subscribe(() => {
    notified = true;
  });
  const handle = errorHandler.handle.bind(errorHandler);
  const handleInline = errorHandler.handleInline.bind(errorHandler);
  const handleOperational = errorHandler.handleOperational.bind(errorHandler);
  const warn = errorHandler.warn.bind(errorHandler);
  const spies: Array<{ mockRestore(): void }> = [
    vi.spyOn(errorHandler, 'handle').mockImplementation((error, context, message) => {
      notified = false;
      const details = handle(error, context, message);
      record(notified ? 'toast' : 'expected-denial', error, context);
      return details;
    }),
    vi.spyOn(errorHandler, 'handleInline').mockImplementation((error, context, message) => {
      record('inline', error, context);
      return handleInline(error, context, message);
    }),
    vi.spyOn(errorHandler, 'handleOperational').mockImplementation((error, context, message) => {
      record('operational', error, context);
      return handleOperational(error, context, message);
    }),
    vi.spyOn(errorHandler, 'warn').mockImplementation((message, options) => {
      record('warning', new Error(message), options?.context);
      return warn(message, options);
    }),
  ];

  // Bootstrap installs the production reporter; wrap whatever is installed so
  // the exception is recorded and still reaches it.
  const setReporter = eventBus.setHandlerErrorReporter.bind(eventBus);
  const wrap =
    (reporter: HandlerReporter): HandlerReporter =>
    (error, event) => {
      record('event-bus', error, { event: String(event) });
      reporter?.(error, event);
    };
  spies.push(
    vi.spyOn(eventBus, 'setHandlerErrorReporter').mockImplementation((reporter) => {
      setReporter(wrap(reporter));
    })
  );
  setReporter(wrap(null));

  return {
    rootOptions: {
      onCaughtError: (error) => record('render-caught', error),
      onUncaughtError: (error) => record('render-uncaught', error),
      onRecoverableError: (error) => record('recoverable', error),
    },
    records: () => [...captured],
    take(match) {
      const taken = captured.filter(match);
      captured = captured.filter((entry) => !taken.includes(entry));
      return taken;
    },
    assertNoneUnexpected() {
      const unexpected = captured.filter(
        (entry) => !entry.kinds.every((kind) => kind === 'expected-denial')
      );
      if (unexpected.length > 0) {
        throw new Error(`Unexpected app error reports:\n${unexpected.map(describe).join('\n')}`);
      }
    },
    restore() {
      spies.forEach((spy) => {
        spy.mockRestore();
      });
      unsubscribe();
      setReporter(null);
    },
  };
};
