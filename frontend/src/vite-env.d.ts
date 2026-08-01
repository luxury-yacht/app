/**
 * frontend/src/vite-env.d.ts
 *
 * Module source for vite-env.d.
 * Implements vite-env.d logic for the frontend.
 */

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RESOURCE_STREAMING?: string;
  readonly VITE_RESOURCE_STREAMING_MODE?: string;
  readonly VITE_RESOURCE_STREAMING_DOMAINS?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __SENTRY_RELEASE__: string;

declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.svg' {
  const value: string;
  export default value;
}
