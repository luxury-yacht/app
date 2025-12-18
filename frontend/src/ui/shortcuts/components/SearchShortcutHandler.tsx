import { useCallback } from 'react';
import { useShortcut } from '../hooks';
import { focusRegisteredSearchShortcutTarget } from '../searchShortcutRegistry';
import { isMacPlatform } from '@/utils/platform';

const SearchShortcutHandler: React.FC = () => {
  const macPlatform = isMacPlatform();
  const handler = useCallback(() => {
    const handled = focusRegisteredSearchShortcutTarget();
    return handled ? true : false;
  }, []);

  useShortcut({
    key: 'f',
    modifiers: macPlatform ? { meta: true } : { ctrl: true },
    handler,
    description: 'Focus active search',
    category: 'Global',
    view: 'global',
    priority: 1000,
  });

  return null;
};

export default SearchShortcutHandler;
