/**
 * Mock helper for controlling what GetAppInfo() returns in Storybook stories.
 * Works by setting an override used by the Storybook Wails v3 transport.
 */

import { Status } from '@bindings/github.com/luxury-yacht/app/backend/internal/appupdates/models';
import { Distribution } from '@bindings/github.com/luxury-yacht/app/internal/updateidentity/models';
import type { backend } from '@core/backend-api/models';

// Default app info returned when no override is set.
const defaultAppInfo: backend.AppInfo = {
  version: '1.3.13',
  buildTime: '2026-03-14T00:00:00Z',
  gitCommit: 'abc1234',
  isBeta: false,
  expiryDate: undefined,
  update: {
    status: Status.StatusCurrent,
    currentVersion: '1.3.13',
    canCheck: true,
    canInstall: true,
    distribution: Distribution.DistributionMacBundle,
  },
};

/** Override the AppInfo returned by the Go backend's GetAppInfo RPC. */
export function setMockAppInfo(info: backend.AppInfo): void {
  window.__storybookBackendOverrides ||= {};
  window.__storybookBackendOverrides.GetAppInfo = () => Promise.resolve(info);
}

// Install the default immediately so GetAppInfo works even without an explicit setMockAppInfo call.
setMockAppInfo(defaultAppInfo);
