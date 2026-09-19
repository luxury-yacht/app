/**
 * frontend/src/ui/shortcuts/useSearchShortcutTarget.ts
 *
 * React hook for useSearchShortcutTarget.
 * Encapsulates state and side effects for the UI layer.
 */

import { useEffect, useRef } from 'react';
import {
  registerSearchShortcutTarget,
  unregisterSearchShortcutTarget,
} from './searchShortcutRegistry';

interface UseSearchShortcutTargetOptions {
  isActive: boolean;
  focus: () => void;
  priority?: number;
  label?: string;
}

export function useSearchShortcutTarget({
  isActive,
  focus,
  priority = 0,
  label,
}: UseSearchShortcutTargetOptions) {
  const stateRef = useRef({
    isActive,
    focus,
    priority,
  });

  useEffect(() => {
    stateRef.current = { isActive, focus, priority };
  }, [isActive, focus, priority]);

  useEffect(() => {
    const id = registerSearchShortcutTarget({
      label,
      isActive: () => stateRef.current.isActive,
      focus: () => stateRef.current.focus(),
      getPriority: () => stateRef.current.priority,
    });
    return () => {
      unregisterSearchShortcutTarget(id);
    };
  }, [label]);
}
