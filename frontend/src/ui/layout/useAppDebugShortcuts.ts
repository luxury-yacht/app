import { useEffect } from 'react';

interface AppDebugShortcutHandlers {
  onTogglePanelDebug: () => void;
  onToggleFocusDebug: () => void;
  onToggleErrorDebug: () => void;
}

/**
 * Debug overlays stay outside the shared shortcut surface model on purpose.
 * These toggles are debugging tools for the app shell itself, so they remain
 * available even when blocking surfaces suppress normal app shortcuts.
 */
export const useAppDebugShortcuts = ({
  onTogglePanelDebug,
  onToggleFocusDebug,
  onToggleErrorDebug,
}: AppDebugShortcutHandlers) => {
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
      }
    };

    window.addEventListener('keydown', handleDebugShortcut);
    return () => window.removeEventListener('keydown', handleDebugShortcut);
  }, [onToggleErrorDebug, onToggleFocusDebug, onTogglePanelDebug]);
};
