import { useEffect, useState, type RefObject } from 'react';
import {
  DEFAULT_TERMINAL_THEME,
  resolveTerminalTheme,
  type TerminalThemeColors,
} from '@shared/terminal/terminalTheme';

export const useTerminalTheme = (rootRef: RefObject<HTMLElement | null>): TerminalThemeColors => {
  const [terminalTheme, setTerminalTheme] = useState<TerminalThemeColors>(DEFAULT_TERMINAL_THEME);

  useEffect(() => {
    const updateTheme = () => {
      setTerminalTheme(
        resolveTerminalTheme(rootRef.current ? getComputedStyle(rootRef.current) : null)
      );
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-appearance-mode', 'class'],
    });

    return () => observer.disconnect();
  }, [rootRef]);

  return terminalTheme;
};
