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

  const idRef = useRef<string | null>(null);

  useEffect(() => {
    stateRef.current = {
      ...stateRef.current,
      isActive,
    };
  }, [isActive]);

  useEffect(() => {
    stateRef.current = {
      ...stateRef.current,
      focus,
    };
  }, [focus]);

  useEffect(() => {
    stateRef.current = {
      ...stateRef.current,
      priority,
    };
  }, [priority]);

  useEffect(() => {
    const id = registerSearchShortcutTarget({
      label,
      isActive: () => Boolean(stateRef.current.isActive),
      focus: () => stateRef.current.focus(),
      getPriority: () => stateRef.current.priority ?? 0,
    });
    idRef.current = id;
    return () => {
      unregisterSearchShortcutTarget(idRef.current);
      idRef.current = null;
    };
  }, [label]);
}
