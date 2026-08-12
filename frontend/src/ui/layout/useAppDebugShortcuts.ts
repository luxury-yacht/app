import { useEffect } from 'react';
import { onEvent, openDevTools } from '@/core/desktop-runtime';

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
    const eventHandlers: Array<[string, () => void]> = [
      ['debug:open-inspector', openWailsInspector],
      ['debug:toggle-panel-overlay', onTogglePanelDebug],
      ['debug:toggle-focus-overlay', onToggleFocusDebug],
      ['debug:toggle-error-overlay', onToggleErrorDebug],
      ['debug:toggle-map-overlay', onToggleMapDebug],
      ['debug:toggle-icon-overlay', onToggleIconDebug],
    ];
    const disposers = eventHandlers.map(([event, handler]) => onEvent(event, handler));

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
