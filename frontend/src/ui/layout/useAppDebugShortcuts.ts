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
    const disposers = [
      onEvent('debug:open-inspector', openWailsInspector),
      onEvent('debug:toggle-panel-overlay', onTogglePanelDebug),
      onEvent('debug:toggle-focus-overlay', onToggleFocusDebug),
      onEvent('debug:toggle-error-overlay', onToggleErrorDebug),
      onEvent('debug:toggle-map-overlay', onToggleMapDebug),
      onEvent('debug:toggle-icon-overlay', onToggleIconDebug),
    ];

    return () => {
      disposers.forEach((dispose) => {
        dispose();
      });
    };
  }, [
    onToggleErrorDebug,
    onToggleFocusDebug,
    onToggleIconDebug,
    onToggleMapDebug,
    onTogglePanelDebug,
  ]);

  useEffect(() => {
    const disposers = [
      eventBus.on('debug:toggle-panel-overlay', onTogglePanelDebug),
      eventBus.on('debug:toggle-focus-overlay', onToggleFocusDebug),
      eventBus.on('debug:toggle-error-overlay', onToggleErrorDebug),
      eventBus.on('debug:toggle-map-overlay', onToggleMapDebug),
      eventBus.on('debug:toggle-icon-overlay', onToggleIconDebug),
    ];
    return () =>
      disposers.forEach((dispose) => {
        dispose();
      });
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
