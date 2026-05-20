import { describe, expect, it, vi } from 'vitest';
import { streamReconnectDelay } from './streamTiming';

describe('streamReconnectDelay', () => {
  it('uses exponential backoff with optional absolute jitter', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(streamReconnectDelay(2, { jitterMs: 250, minMs: 500 })).toBe(4125);

    random.mockRestore();
  });

  it('supports proportional jitter for websocket reconnects', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(streamReconnectDelay(1, { jitterFactor: 0.2, round: true })).toBe(1600);

    random.mockRestore();
  });

  it('honors max and min delay bounds', () => {
    expect(streamReconnectDelay(10, { maxMs: 30_000 })).toBe(30_000);
    expect(streamReconnectDelay(0, { baseMs: 100, minMs: 500 })).toBe(500);
  });
});
