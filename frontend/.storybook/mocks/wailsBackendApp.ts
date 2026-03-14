/**
 * Mock helper for controlling what GetAppInfo() returns in Storybook stories.
 * Works by setting an override on window.__storybookGoOverrides, which the
 * window.go proxy in preview.ts checks before falling back to a no-op.
 */

import { backend } from './wailsModels';

// Default app info returned when no override is set.
const defaultAppInfo = new backend.AppInfo({
  version: '1.3.13',
  buildTime: '2026-03-14T00:00:00Z',
  gitCommit: 'abc1234',
  isBeta: false,
  expiryDate: undefined,
  update: new backend.UpdateInfo({
    currentVersion: '1.3.13',
    latestVersion: '1.3.13',
    releaseUrl: '',
    isUpdateAvailable: false,
  }),
});

/** Override the AppInfo returned by the Go backend's GetAppInfo RPC. */
export function setMockAppInfo(info: backend.AppInfo): void {
  (window as any).__storybookGoOverrides = (window as any).__storybookGoOverrides || {};
  (window as any).__storybookGoOverrides['GetAppInfo'] = () => Promise.resolve(info);
}

// Install the default immediately so GetAppInfo works even without an explicit setMockAppInfo call.
setMockAppInfo(defaultAppInfo);
