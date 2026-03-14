/**
 * Mock for @wailsjs/runtime/runtime used in Storybook.
 * Replaces Wails runtime APIs with browser-compatible stubs.
 */

// Open URLs in a new browser tab instead of the Wails-managed browser.
export function BrowserOpenURL(url: string): void {
  window.open(url, '_blank');
}

// Stub event system — no-ops so components that subscribe to events don't break.
export function EventsOn(_eventName: string, _callback: (...data: unknown[]) => void): void {}
export function EventsOff(_eventName: string): void {}
export function EventsEmit(_eventName: string, ..._data: unknown[]): void {}
export function EventsOnMultiple(
  _eventName: string,
  _callback: (...data: unknown[]) => void,
  _maxCallbacks: number
): void {}
