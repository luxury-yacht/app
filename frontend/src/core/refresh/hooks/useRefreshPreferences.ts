import { useSyncExternalStore } from 'react';
import { eventBus } from '@/core/events';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';

const subscribeAutoRefresh = (onChange: () => void) =>
  eventBus.on('settings:auto-refresh', onChange);

export const useAutoRefreshEnabled = () =>
  useSyncExternalStore(subscribeAutoRefresh, getAutoRefreshEnabled);
