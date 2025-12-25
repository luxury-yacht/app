/**
 * frontend/src/hooks/useWailsRuntimeEvents.ts
 *
 * Hook for useWailsRuntimeEvents.
 * Subscribes to Wails runtime events for UI actions (menu items, etc.) and connection status updates.
 */
import { useEffect } from 'react';
import {
  ConnectionStatusEvent,
  useConnectionStatusActions,
} from '@/core/connection/connectionStatus';

interface WailsRuntimeEventHandlers {
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onToggleSidebar: () => void;
  onToggleAppLogs: () => void;
  onToggleDiagnostics: () => void;
}

/**
 * Subscribes to Wails runtime events for UI actions (menu items, etc.)
 */
export function useWailsRuntimeEvents(handlers: WailsRuntimeEventHandlers): void {
  const { onOpenSettings, onOpenAbout, onToggleSidebar, onToggleAppLogs, onToggleDiagnostics } =
    handlers;

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const eventHandlers: Array<[string, () => void]> = [
      ['open-settings', onOpenSettings],
      ['open-about', onOpenAbout],
      ['toggle-sidebar', onToggleSidebar],
      ['toggle-app-logs', onToggleAppLogs],
      ['toggle-diagnostics', onToggleDiagnostics],
    ];

    eventHandlers.forEach(([event, handler]) => runtime.EventsOn?.(event, handler));

    return () => {
      eventHandlers.forEach(([event]) => runtime.EventsOff?.(event));
    };
  }, [onOpenSettings, onOpenAbout, onToggleSidebar, onToggleAppLogs, onToggleDiagnostics]);
}

/**
 * Subscribes to connection status events from Wails runtime
 */
export function useConnectionStatusListener(): void {
  const { updateFromEvent } = useConnectionStatusActions();

  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const handleConnectionStatus = (...args: unknown[]) => {
      const payload = (args[0] as ConnectionStatusEvent) || undefined;
      updateFromEvent(payload);
    };

    runtime.EventsOn('connection-status', handleConnectionStatus);

    return () => {
      runtime.EventsOff?.('connection-status');
    };
  }, [updateFromEvent]);
}
