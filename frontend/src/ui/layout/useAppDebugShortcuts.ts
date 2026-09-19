import { useEffect } from 'react';
import { onEvent, openDevTools } from '@/core/desktop-runtime';
import { eventBus } from '@/core/events';

interface AppDebugShortcutHandlers {
  onTogglePanelDebug: () => void;
  onToggleFocusDebug: () => void;
  onToggleErrorDebug: () => void;
  onToggleMapDebug: () => void;
  onToggleIconDebug: () => void;
}

const openWailsInspector = () => {
  void openDevTools();
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
    const toggles = [
      { event: 'debug:toggle-panel-overlay', key: 'p', handler: onTogglePanelDebug },
      { event: 'debug:toggle-focus-overlay', key: 'k', handler: onToggleFocusDebug },
      { event: 'debug:toggle-error-overlay', key: 'e', handler: onToggleErrorDebug },
      { event: 'debug:toggle-map-overlay', key: 'm', handler: onToggleMapDebug },
      { event: 'debug:toggle-icon-overlay', key: 'i', handler: onToggleIconDebug },
    ] as const;
    const disposers = [
      onEvent('debug:open-inspector', openWailsInspector),
      ...toggles.map(({ event, handler }) => onEvent(event, handler)),
      ...toggles.map(({ event, handler }) => eventBus.on(event, handler)),
    ];
    const handleDebugShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey) {
        return;
      }
      const toggle = toggles.find(({ key }) => key === event.key.toLowerCase());
      if (toggle) {
        event.preventDefault();
        toggle.handler();
      }
    };
    window.addEventListener('keydown', handleDebugShortcut);
    return () => {
      disposers.forEach((dispose) => {
        dispose();
      });
      window.removeEventListener('keydown', handleDebugShortcut);
    };
  }, [
    onToggleErrorDebug,
    onToggleFocusDebug,
    onToggleIconDebug,
    onToggleMapDebug,
    onTogglePanelDebug,
  ]);
};
