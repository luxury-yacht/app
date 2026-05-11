import { useEffect } from 'react';
import { isMacPlatform, isWindowsPlatform } from '@/utils/platform';

interface AppDebugShortcutHandlers {
  onTogglePanelDebug: () => void;
  onToggleFocusDebug: () => void;
  onToggleErrorDebug: () => void;
  onToggleMapDebug: () => void;
  onToggleIconDebug: () => void;
}

const openWailsInspector = () => {
  const wailsInvoke = (window as Window & { WailsInvoke?: (message: string) => void }).WailsInvoke;
  if (!wailsInvoke || isWindowsPlatform()) {
    return;
  }

  wailsInvoke(isMacPlatform() ? 'wails:openInspector' : 'wails:showInspector');
};

/**
 * Debug overlays stay outside the shared shortcut surface model on purpose.
 * These toggles are debugging tools for the app shell itself, so they remain
 * available even when blocking surfaces suppress normal app shortcuts.
 */
export const useAppDebugShortcuts = ({
  onTogglePanelDebug,
  onToggleFocusDebug,
  onToggleErrorDebug,
  onToggleMapDebug,
  onToggleIconDebug,
}: AppDebugShortcutHandlers) => {
  useEffect(() => {
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const eventHandlers: Array<[string, () => void]> = [
      ['debug:open-inspector', openWailsInspector],
      ['debug:toggle-panel-overlay', onTogglePanelDebug],
      ['debug:toggle-focus-overlay', onToggleFocusDebug],
      ['debug:toggle-error-overlay', onToggleErrorDebug],
      ['debug:toggle-map-overlay', onToggleMapDebug],
      ['debug:toggle-icon-overlay', onToggleIconDebug],
    ];
    const disposers = eventHandlers.map(([event, handler]) => {
      const dispose = runtime.EventsOn?.(event, handler);
      if (typeof dispose === 'function') {
        return dispose;
      }
      return () => runtime.EventsOff?.(event, handler);
    });

    return () => {
      disposers.forEach((dispose) => dispose());
    };
  }, [
    onToggleErrorDebug,
    onToggleFocusDebug,
    onToggleIconDebug,
    onToggleMapDebug,
    onTogglePanelDebug,
  ]);

  useEffect(() => {
    const handleDebugShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isCtrlAlt = event.ctrlKey && event.altKey;
      if (!isCtrlAlt) {
        return;
      }

      if (key === 'p') {
        event.preventDefault();
        onTogglePanelDebug();
      } else if (key === 'k') {
        event.preventDefault();
        onToggleFocusDebug();
      } else if (key === 'e') {
        event.preventDefault();
        onToggleErrorDebug();
      } else if (key === 'm') {
        event.preventDefault();
        onToggleMapDebug();
      } else if (key === 'i') {
        event.preventDefault();
        onToggleIconDebug();
      }
    };

    window.addEventListener('keydown', handleDebugShortcut);
    return () => window.removeEventListener('keydown', handleDebugShortcut);
  }, [
    onToggleErrorDebug,
    onToggleFocusDebug,
    onToggleIconDebug,
    onToggleMapDebug,
    onTogglePanelDebug,
  ]);
};
