import type { Preview } from '@storybook/react';
import '../styles/index.css';

// Stub Wails globals so generated .js files work outside the Wails desktop shell.
// The Wails runtime.js calls window.runtime.*, and App.js calls window.go.backend.App.*.
const noOp = () => {};
const noOpAsync = () => Promise.resolve();

// Proxy that returns noOp for any property access — handles window.runtime.*
const runtimeProxy = new Proxy(
  {
    BrowserOpenURL: (url: string) => window.open(url, '_blank'),
  },
  {
    get(target: Record<string, unknown>, prop: string) {
      return target[prop] ?? noOp;
    },
  },
);

// Overrides for specific Go backend methods. Stories populate this via
// setMockAppInfo() in .storybook/mocks/wailsBackendApp.ts.
(window as any).__storybookGoOverrides = {} as Record<string, (...args: unknown[]) => unknown>;

// Nested proxy for window.go.backend.App.* — returns async noOp for Go RPCs
// unless an override exists.
const goProxy = new Proxy(
  {},
  {
    get() {
      // Returns a proxy for each namespace (e.g. "backend")
      return new Proxy(
        {},
        {
          get() {
            // Returns a proxy for each struct (e.g. "App")
            return new Proxy(
              {},
              {
                get(_target: object, method: string) {
                  const overrides = (window as any).__storybookGoOverrides;
                  if (overrides[method]) {
                    return overrides[method];
                  }
                  return noOpAsync;
                },
              },
            );
          },
        },
      );
    },
  },
);

(window as any).runtime = runtimeProxy;
(window as any).go = goProxy;

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
