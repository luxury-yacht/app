import { describe, expect, it, vi } from 'vitest';

import { requestAppState } from './appStateAccess';

describe('appStateAccess', () => {
  it('executes app-state reads through the shared request path', async () => {
    const read = vi.fn().mockResolvedValue({ version: '1.0.0' });

    await expect(
      requestAppState({
        resource: 'app-info',
        read,
      })
    ).resolves.toEqual({ version: '1.0.0' });

    expect(read).toHaveBeenCalledTimes(1);
  });
});
