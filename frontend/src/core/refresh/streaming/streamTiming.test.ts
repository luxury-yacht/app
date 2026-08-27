import { describe, expect, it, vi } from 'vitest';
import { streamReconnectDelay } from './streamTiming';

// Drives the unit random the delay derives its jitter from. The value is
// written straight into the caller's Uint32Array, so `unit` maps onto the same
// [0, 1) range Math.random would have produced.
const mockUnitRandom = (unit: number) =>
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
    (array as Uint32Array)[0] = unit * 2 ** 32;
    return array;
  });

describe('streamReconnectDelay', () => {
  it('covers streamReconnectDelay scenarios', async () => {
    {
      // Scenario: draws jitter from the platform CSPRNG, not Math.random
      const random = mockUnitRandom(0.5);
      const mathRandom = vi.spyOn(Math, 'random');

      streamReconnectDelay(2, { jitterMs: 250 });

      expect(random).toHaveBeenCalled();
      expect(mathRandom).not.toHaveBeenCalled();

      random.mockRestore();
      mathRandom.mockRestore();
    }

    {
      // Scenario: uses exponential backoff with optional absolute jitter
      const random = mockUnitRandom(0.5);

      expect(streamReconnectDelay(2, { jitterMs: 250, minMs: 500 })).toBe(4125);

      random.mockRestore();
    }

    {
      // Scenario: supports proportional jitter for named-stream reconnects
      const random = mockUnitRandom(0);

      expect(streamReconnectDelay(1, { jitterFactor: 0.2, round: true })).toBe(1600);

      random.mockRestore();
    }
    // Scenario: honors max and min delay bounds
    expect(streamReconnectDelay(10, { maxMs: 30_000 })).toBe(30_000);
    expect(streamReconnectDelay(0, { baseMs: 100, minMs: 500 })).toBe(500);
  });
});
