/**
 * frontend/src/ui/shortcuts/components/SearchShortcutHandler.tsx
 *
 * UI component for SearchShortcutHandler.
 * Handles rendering and interactions for the shared components.
 */

import { useCallback } from 'react';
import { isMacPlatform } from '@/utils/platform';
import { useShortcut } from '../hooks';
import { focusRegisteredSearchShortcutTarget } from '../searchShortcutRegistry';

const SearchShortcutHandler: React.FC = () => {
  const macPlatform = isMacPlatform();
  const handler = useCallback(() => {
    const handled = focusRegisteredSearchShortcutTarget();
    return !!handled;
  }, []);

  useShortcut({
    key: 'f',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler,
    description: 'Focus active search',
    category: 'Global',
    priority: 1000,
  });

  return null;
};

export default SearchShortcutHandler;
