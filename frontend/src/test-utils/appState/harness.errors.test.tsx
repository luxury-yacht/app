/**
 * frontend/src/test-utils/appState/harness.errors.test.tsx
 *
 * The harness fails a test on any unexpected failure report, whichever path it
 * takes. Only toast reports reach `subscribeToErrors`; inline, operational,
 * event-bus, and boundary-caught render failures do not. Each case below must
 * be caught, or a crashing component could pass its suite.
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { eventBus } from '@/core/events';
import DetailsTabDataErrorBoundary from '@/modules/object-panel/components/ObjectPanel/Details/DetailsTabDataErrorBoundary';
import { ErrorBoundary } from '@/shared/components/errors/ErrorBoundary';
import { makeErrorStatus } from '@/test-utils/errorStatusFixtures';
import { errorHandler } from '@/utils/errorHandler';
import { installAppStateHarness } from './harness';

const app = installAppStateHarness();

function Crash(): never {
  throw new Error('render failed');
}

const startApp = async () => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  return app.render(null);
};

/**
 * The harness's after-test check, run now: returns its rejection message (or
 * null when it accepts), then clears the records so the real check passes.
 */
const afterTestRejection = (): string | null => {
  try {
    app.errors.assertNoneUnexpected();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    app.errors.take(() => true);
  }
};

describe('reports that bypass toast listeners', () => {
  it('fails on an unexpected inline report', async () => {
    await startApp();

    errorHandler.handleInline(new Error('port forward failed'), { action: 'startPortForward' });

    expect(afterTestRejection()).toMatch(/\binline\b/);
  });

  it('fails on an unexpected operational report', async () => {
    await startApp();

    errorHandler.handleOperational(new Error('persist failed'), { action: 'persistTableState' });

    expect(afterTestRejection()).toMatch(/\boperational\b/);
  });

  it('fails on an exception in an event-bus handler', async () => {
    await startApp();
    const unsubscribe = eventBus.on('view:toggle-diagnostics', () => {
      throw new Error('handler failed');
    });

    eventBus.emit('view:toggle-diagnostics');
    unsubscribe();

    expect(afterTestRejection()).toMatch(/\bevent-bus\b/);
  });
});

describe('render failures caught by boundaries', () => {
  it('fails on a crash caught by a boundary that reports only operationally', async () => {
    const view = await startApp();

    await view.show(
      <DetailsTabDataErrorBoundary>
        <Crash />
      </DetailsTabDataErrorBoundary>
    );

    expect(afterTestRejection()).toMatch(/\brender-caught\b/);
  });

  it('fails on a crash caught by an isolated boundary that reports nothing', async () => {
    const view = await startApp();

    await view.show(
      <ErrorBoundary isolate scope="isolated" fallback={() => null}>
        <Crash />
      </ErrorBoundary>
    );

    expect(afterTestRejection()).toMatch(/\brender-caught\b/);
  });
});

describe('reports the harness accepts', () => {
  it('passes an expected permission denial', async () => {
    await startApp();
    const denial = Object.assign(new Error('forbidden'), {
      status: makeErrorStatus('Forbidden', 'pods is forbidden'),
    });

    act(() => {
      errorHandler.handle(denial, { action: 'listPods' });
    });

    expect(() => app.errors.assertNoneUnexpected()).not.toThrow();
    expect(app.errors.records().map((record) => record.kinds)).toEqual([['expected-denial']]);
  });

  it('passes a failure the test consumed', async () => {
    await startApp();

    errorHandler.handleOperational(new Error('persist failed'), { action: 'persistTableState' });
    const taken = app.errors.take((record) => record.kinds.includes('operational'));

    expect(taken).toHaveLength(1);
    expect(() => app.errors.assertNoneUnexpected()).not.toThrow();
  });
});
