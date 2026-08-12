import { objectNames, type RuntimeTransport } from '@wailsio/runtime';

export type StorybookBackendOverrides = Record<
  string,
  (...args: unknown[]) => unknown | Promise<unknown>
>;

interface NamedCallRequest {
  methodName?: unknown;
  args?: unknown;
}

const backendMethodName = (qualifiedName: string): string =>
  qualifiedName.slice(qualifiedName.lastIndexOf('.') + 1);

export const createStorybookWailsTransport = (
  overrides: StorybookBackendOverrides,
  openURL: (url: string) => unknown = (url) => window.open(url, '_blank')
): RuntimeTransport => ({
  async call(objectID, method, _windowName, args: unknown) {
    if (objectID === objectNames.Call && method === 0) {
      const request = (args ?? {}) as NamedCallRequest;
      if (typeof request.methodName !== 'string') {
        return undefined;
      }

      const override = overrides[backendMethodName(request.methodName)];
      if (!override) {
        return undefined;
      }

      return override(...(Array.isArray(request.args) ? request.args : []));
    }

    if (objectID === objectNames.Browser && method === 0) {
      const url = (args as { url?: unknown } | null)?.url;
      if (typeof url === 'string') {
        openURL(url);
      }
    }

    return undefined;
  },
});
