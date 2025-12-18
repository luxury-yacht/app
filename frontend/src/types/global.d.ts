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
