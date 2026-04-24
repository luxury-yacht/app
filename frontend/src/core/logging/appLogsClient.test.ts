import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  logAppLogsDebug,
  logAppLogsError,
  logAppLogsInfo,
  logAppLogsWarn,
  subscribeAppLogsAdded,
} from './appLogsClient';

const logAppLogsFromFrontendMock = vi.fn();

const setBackendLogApi = (api: unknown) => {
  (window as any).go = {
    backend: {
      App: api,
    },
  };
};

describe('appLogsClient', () => {
  beforeEach(() => {
    logAppLogsFromFrontendMock.mockReset();
    setBackendLogApi({
      LogAppLogsFromFrontend: logAppLogsFromFrontendMock,
    });
    delete (window as any).runtime;
  });

  afterEach(() => {
    delete (window as any).go;
    delete (window as any).runtime;
  });

  it('sends frontend logs to backend application logs with normalized inputs', () => {
    logAppLogsDebug(' debug message ', ' DebugSource ');
    logAppLogsInfo(' info message ', ' InfoSource ');
    logAppLogsWarn(' warn message ', ' WarnSource ');
    logAppLogsError(' error message ', ' ErrorSource ');

    expect(logAppLogsFromFrontendMock).toHaveBeenNthCalledWith(
      1,
      'debug',
      'debug message',
      'DebugSource'
    );
    expect(logAppLogsFromFrontendMock).toHaveBeenNthCalledWith(
      2,
      'info',
      'info message',
      'InfoSource'
    );
    expect(logAppLogsFromFrontendMock).toHaveBeenNthCalledWith(
      3,
      'warn',
      'warn message',
      'WarnSource'
    );
    expect(logAppLogsFromFrontendMock).toHaveBeenNthCalledWith(
      4,
      'error',
      'error message',
      'ErrorSource'
    );
  });

  it('uses Frontend as the default source and skips blank messages', () => {
    logAppLogsInfo(' visible message ', '   ');
    logAppLogsError('   ', 'Errors');

    expect(logAppLogsFromFrontendMock).toHaveBeenCalledTimes(1);
    expect(logAppLogsFromFrontendMock).toHaveBeenCalledWith('info', 'visible message', 'Frontend');
  });

  it('ignores unavailable or failing backend logging APIs', () => {
    delete (window as any).go;
    expect(() => logAppLogsError('missing api', 'Frontend')).not.toThrow();

    setBackendLogApi({});
    expect(() => logAppLogsError('missing method', 'Frontend')).not.toThrow();

    logAppLogsFromFrontendMock.mockImplementationOnce(() => {
      throw new Error('backend failed');
    });
    setBackendLogApi({
      LogAppLogsFromFrontend: logAppLogsFromFrontendMock,
    });

    expect(() => logAppLogsError('backend failure', 'Frontend')).not.toThrow();
  });

  it('subscribes to app-logs events and returns the Wails disposer', () => {
    const dispose = vi.fn();
    const handler = vi.fn();
    (window as any).runtime = {
      EventsOn: vi.fn((_eventName: string, eventHandler: (event?: unknown) => void) => {
        eventHandler({ sequence: 12 });
        eventHandler('unexpected payload');
        return dispose;
      }),
      EventsOff: vi.fn(),
    };

    const unsubscribe = subscribeAppLogsAdded(handler);

    expect(window.runtime?.EventsOn).toHaveBeenCalledWith('app-logs:added', expect.any(Function));
    expect(handler).toHaveBeenNthCalledWith(1, { sequence: 12 });
    expect(handler).toHaveBeenNthCalledWith(2, undefined);

    unsubscribe();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(window.runtime?.EventsOff).not.toHaveBeenCalled();
  });

  it('falls back to callback-specific EventsOff when EventsOn has no disposer', () => {
    const handler = vi.fn();
    (window as any).runtime = {
      EventsOn: vi.fn(),
      EventsOff: vi.fn(),
    };

    const unsubscribe = subscribeAppLogsAdded(handler);
    unsubscribe();

    expect(window.runtime?.EventsOff).toHaveBeenCalledWith('app-logs:added', expect.any(Function));
  });
});
