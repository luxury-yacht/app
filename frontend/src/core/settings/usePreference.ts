/**
 * frontend/src/core/settings/usePreference.ts
 *
 * React reader for one app preference. Re-renders when that preference changes,
 * including hydration, optimistic edits, and a failed save's rollback.
 */

import { useCallback, useSyncExternalStore } from 'react';
import {
  type AppPreferenceKey,
  type AppPreferences,
  getPreference,
  subscribePreference,
} from './appPreferences';

export function usePreference<K extends AppPreferenceKey>(key: K): AppPreferences[K] {
  const subscribe = useCallback(
    (onChange: () => void) => subscribePreference(key, onChange),
    [key]
  );
  const read = useCallback(() => getPreference(key), [key]);
  return useSyncExternalStore(subscribe, read);
}
