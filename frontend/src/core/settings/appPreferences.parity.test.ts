/**
 * frontend/src/core/settings/appPreferences.parity.test.ts
 *
 * The frontend preference store agrees with the backend preference schema
 * (backend/internal/preferenceschema): every preference's metadata matches the
 * generated spec, and hydration settles every generated boundary input on the
 * value the backend's Repair rule settles it on. The Day.js format's stricter
 * frontend check is a deliberate difference; the vectors carry only the cases
 * both sides share.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AppPreferenceKey,
  getPreference,
  getPreferenceMetadata,
  hydrateAppPreferences,
  resetAppPreferencesCacheForTesting,
} from './appPreferences';
import { APP_PREFERENCE_KEYS, APP_PREFERENCE_SPECS } from './appPreferences.generated';
import parity from './appPreferences.parity.generated.json';

const appMocks = vi.hoisted(() => ({
  GetAppSettings: vi.fn(),
}));

vi.mock('@core/backend-api', () => ({
  GetAppSettings: (...args: unknown[]) => appMocks.GetAppSettings(...args),
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => true,
  emitBroadcastEvent: vi.fn(),
}));

interface ParityVector {
  key: AppPreferenceKey;
  input: unknown;
  repaired: unknown;
}

const vectors = parity.vectors as ParityVector[];

describe('app preference parity with the backend schema', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    appMocks.GetAppSettings.mockReset();
  });

  it.each(APP_PREFERENCE_KEYS)('%s metadata matches the backend spec', (key) => {
    expect(getPreferenceMetadata(key)).toMatchObject(APP_PREFERENCE_SPECS[key]);
  });

  it.each(
    vectors.map((vector) => [`${vector.key} ← ${JSON.stringify(vector.input)}`, vector] as const)
  )('hydration settles %s like the backend', async (_name, vector) => {
    appMocks.GetAppSettings.mockResolvedValue({ [vector.key]: vector.input });

    await hydrateAppPreferences({ force: true });

    expect(getPreference(vector.key)).toEqual(vector.repaired);
  });
});
