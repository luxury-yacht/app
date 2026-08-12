import { describe, expect, it, vi } from 'vitest';
import { createStorybookWailsTransport } from './wailsTransport';

describe('createStorybookWailsTransport', () => {
  it('dispatches a named backend call to the method override', async () => {
    const getAppInfo = vi.fn().mockResolvedValue({ version: '3.0.0' });
    const transport = createStorybookWailsTransport({ GetAppInfo: getAppInfo });

    await expect(
      transport.call(0, 0, '', {
        methodName: 'github.com/luxury-yacht/app/backend.App.GetAppInfo',
        args: [],
      })
    ).resolves.toEqual({ version: '3.0.0' });
    expect(getAppInfo).toHaveBeenCalledOnce();
  });

  it('passes backend arguments and returns undefined for unmocked calls', async () => {
    const updateFavorite = vi.fn().mockResolvedValue(undefined);
    const transport = createStorybookWailsTransport({ UpdateFavorite: updateFavorite });

    await transport.call(0, 0, '', {
      methodName: 'github.com/luxury-yacht/app/backend.App.UpdateFavorite',
      args: [{ id: 'favorite-1' }],
    });

    expect(updateFavorite).toHaveBeenCalledWith({ id: 'favorite-1' });
    await expect(
      transport.call(0, 0, '', {
        methodName: 'github.com/luxury-yacht/app/backend.App.GetThemes',
        args: [],
      })
    ).resolves.toBeUndefined();
  });

  it('opens URLs requested through the v3 browser runtime object', async () => {
    const openURL = vi.fn();
    const transport = createStorybookWailsTransport({}, openURL);

    await transport.call(9, 0, '', { url: 'https://example.com/release' });

    expect(openURL).toHaveBeenCalledWith('https://example.com/release');
  });
});
