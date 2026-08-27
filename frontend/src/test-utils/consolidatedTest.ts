/* v8 ignore file -- test registration infrastructure is exercised by the suites it consolidates. */

import { describe as registerDescribe, it as registerTest, type TestContext, vi } from 'vitest';

type Awaitable<T> = T | Promise<T>;
type TestCallback = (context: TestContext) => Awaitable<unknown>;
type HookCallback = (context: TestContext) => Awaitable<unknown>;

interface Scope {
  name: string;
  beforeAll: HookCallback[];
  beforeEach: HookCallback[];
  afterEach: HookCallback[];
  afterAll: HookCallback[];
}

interface Scenario {
  name: string;
  callback: TestCallback;
  scopes: Scope[];
}

interface ConsolidatedTest {
  (name: string, callback: TestCallback, timeout?: number): void;
  (name: string, options: unknown, callback: TestCallback): void;
}

type ConsolidatedDescribe = (name: string, callback: () => void) => void;

const scenarioName = (scopes: Scope[], name: string): string =>
  [...scopes.map((scope) => scope.name).filter(Boolean), name].join(' > ');

const asError = (error: unknown, name: string): Error => {
  const failure = error instanceof Error ? error : new Error(String(error));
  failure.message = `${name}: ${failure.message}`;
  if (failure.stack) {
    failure.stack = `${name}\n${failure.stack}`;
  }
  return failure;
};

const runHook = async (
  hook: HookCallback,
  context: TestContext,
  returnedCleanups: Array<() => Awaitable<unknown>>
): Promise<void> => {
  const cleanupCallback = await hook(context);
  if (typeof cleanupCallback === 'function') {
    returnedCleanups.push(cleanupCallback as () => Awaitable<unknown>);
  }
};

const resetSharedTestState = async (): Promise<void> => {
  const { resetResourceInventoryRowCache } = await vi.importActual<
    typeof import('@/modules/resource-grid/useResourceInventoryTable')
  >('@/modules/resource-grid/useResourceInventoryTable');
  const { __resetModalFocusTrapForTest } = await vi.importActual<
    typeof import('@/shared/components/modals/useModalFocusTrap')
  >('@/shared/components/modals/useModalFocusTrap');
  resetResourceInventoryRowCache();
  __resetModalFocusTrapForTest();
};

/**
 * Registers one Vitest contract while retaining named scenarios and scoped lifecycle hooks.
 * Use for mature suites whose many micro-tests exercise one cohesive behavior surface.
 */
export const createConsolidatedSuite = (
  title: string,
  timeout = 120_000
): {
  describe: ConsolidatedDescribe;
  it: ConsolidatedTest;
  test: ConsolidatedTest;
  beforeAll: (callback: HookCallback) => void;
  beforeEach: (callback: HookCallback) => void;
  afterEach: (callback: HookCallback) => void;
  afterAll: (callback: HookCallback) => void;
} => {
  const root: Scope = {
    name: '',
    beforeAll: [],
    beforeEach: [],
    afterEach: [],
    afterAll: [],
  };
  const scopeStack = [root];
  const scenarios: Scenario[] = [];

  const currentScope = (): Scope => scopeStack[scopeStack.length - 1] ?? root;

  const addScenario = (
    name: string,
    callbackOrOptions: unknown,
    possibleCallback?: unknown
  ): void => {
    const callback = typeof callbackOrOptions === 'function' ? callbackOrOptions : possibleCallback;
    if (typeof callback !== 'function') {
      throw new TypeError(`Consolidated scenario ${name} is missing a callback`);
    }
    scenarios.push({
      name,
      callback: callback as TestCallback,
      scopes: [...scopeStack],
    });
  };

  const it = ((name: string, callbackOrOptions: unknown, possibleCallback?: unknown) => {
    addScenario(name, callbackOrOptions, possibleCallback);
  }) as ConsolidatedTest;

  const describe = ((name: string, callback: () => void) => {
    const scope: Scope = {
      name,
      beforeAll: [],
      beforeEach: [],
      afterEach: [],
      afterAll: [],
    };
    scopeStack.push(scope);
    try {
      callback();
    } finally {
      scopeStack.pop();
    }
  }) as ConsolidatedDescribe;

  const registerHook =
    (key: 'beforeAll' | 'beforeEach' | 'afterEach' | 'afterAll') =>
    (callback: HookCallback): void => {
      currentScope()[key].push(callback);
    };

  registerDescribe(title, () => {
    registerTest(
      'covers consolidated scenarios',
      async (context) => {
        const firstScenario = new Map<Scope, number>();
        const lastScenario = new Map<Scope, number>();
        for (const [index, scenario] of scenarios.entries()) {
          for (const scope of scenario.scopes) {
            if (!firstScenario.has(scope)) {
              firstScenario.set(scope, index);
            }
            lastScenario.set(scope, index);
          }
        }

        const beforeAllCleanups = new Map<Scope, Array<() => Awaitable<unknown>>>();
        const failures: Error[] = [];

        for (const [index, scenario] of scenarios.entries()) {
          const name = scenarioName(scenario.scopes, scenario.name);
          const beforeEachCleanups: Array<() => Awaitable<unknown>> = [];
          try {
            for (const scope of scenario.scopes) {
              if (firstScenario.get(scope) === index) {
                const cleanups: Array<() => Awaitable<unknown>> = [];
                beforeAllCleanups.set(scope, cleanups);
                for (const hook of scope.beforeAll) {
                  await runHook(hook, context, cleanups);
                }
              }
            }
            for (const scope of scenario.scopes) {
              for (const hook of scope.beforeEach) {
                await runHook(hook, context, beforeEachCleanups);
              }
            }

            await scenario.callback(context);
          } catch (error) {
            failures.push(asError(error, name));
          } finally {
            for (const scope of [...scenario.scopes].reverse()) {
              for (const hook of scope.afterEach) {
                try {
                  await hook(context);
                } catch (error) {
                  failures.push(asError(error, `${name} afterEach`));
                }
              }
            }
            for (const cleanupCallback of beforeEachCleanups.reverse()) {
              try {
                await cleanupCallback();
              } catch (error) {
                failures.push(asError(error, `${name} beforeEach cleanup`));
              }
            }
            await resetSharedTestState();

            for (const scope of [...scenario.scopes].reverse()) {
              if (lastScenario.get(scope) !== index) {
                continue;
              }
              for (const hook of scope.afterAll) {
                try {
                  await hook(context);
                } catch (error) {
                  failures.push(asError(error, `${scope.name} afterAll`));
                }
              }
              for (const cleanupCallback of (beforeAllCleanups.get(scope) ?? []).reverse()) {
                try {
                  await cleanupCallback();
                } catch (error) {
                  failures.push(asError(error, `${scope.name} beforeAll cleanup`));
                }
              }
            }
          }
        }

        if (failures.length === 1) {
          throw failures[0];
        }
        if (failures.length > 1) {
          const [first, ...rest] = failures;
          if (first) {
            first.message = `${failures.length} consolidated scenarios failed; first failure: ${first.message}`;
            first.stack = `${first.stack ?? first.message}\n\nAdditional failures:\n${rest
              .map((failure) => failure.stack ?? failure.message)
              .join('\n\n')}`;
            throw first;
          }
        }
      },
      timeout
    );
  });

  return {
    describe,
    it,
    test: it,
    beforeAll: registerHook('beforeAll'),
    beforeEach: registerHook('beforeEach'),
    afterEach: registerHook('afterEach'),
    afterAll: registerHook('afterAll'),
  };
};
