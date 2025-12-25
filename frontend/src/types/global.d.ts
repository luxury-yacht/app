/**
 * frontend/src/types/global.d.ts
 *
 * Type definitions for global.d.
 * Defines shared interfaces and payload shapes for the frontend.
 */

export {};

declare global {
  interface WailsRuntime {
    [key: string]: unknown;
    Environment?: () => Promise<Record<string, string>>;
    EventsOn?: (eventName: string, callback: (...args: unknown[]) => void) => void;
    EventsOff?: (eventName: string, callback?: (...args: unknown[]) => void) => void;
  }

  interface Window {
    runtime?: WailsRuntime;
  }
}
