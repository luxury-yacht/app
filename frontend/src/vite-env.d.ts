/**
 * frontend/src/vite-env.d.ts
 *
 * Module source for vite-env.d.
 * Implements vite-env.d logic for the frontend.
 */

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RESOURCE_STREAMING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.png' {
  const value: string;
  export default value;
}
