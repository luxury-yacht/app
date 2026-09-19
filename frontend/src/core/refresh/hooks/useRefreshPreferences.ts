import { useSyncExternalStore } from 'react';
import { eventBus } from '@/core/events';
import { getAutoRefreshEnabled, getBackgroundRefreshEnabled } from '@/core/settings/appPreferences';

const subscribeAutoRefresh = (onChange: () => void) =>
  eventBus.on('settings:auto-refresh', onChange);
const subscribeBackgroundRefresh = (onChange: () => void) =>
  eventBus.on('settings:refresh-background', onChange);

export const useAutoRefreshEnabled = () =>
  useSyncExternalStore(subscribeAutoRefresh, getAutoRefreshEnabled);

export const useBackgroundRefreshEnabled = () =>
  useSyncExternalStore(subscribeBackgroundRefresh, getBackgroundRefreshEnabled);
