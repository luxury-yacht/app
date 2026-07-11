export const streamReconnectDelay = (
  attempt: number,
  options: {
    baseMs?: number;
    maxMs?: number;
    minMs?: number;
    jitterMs?: number;
    jitterFactor?: number;
    round?: boolean;
  } = {}
): number => {
  const baseMs = options.baseMs ?? 1000;
  const maxMs = options.maxMs ?? 30_000;
  const minMs = options.minMs ?? 0;
  const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
  const absoluteJitter = options.jitterMs ? Math.random() * options.jitterMs : 0;
  const proportionalJitter = options.jitterFactor
    ? backoff * ((Math.random() * 2 - 1) * options.jitterFactor)
    : 0;
  const delay = Math.max(minMs, backoff + absoluteJitter + proportionalJitter);
  return options.round ? Math.round(delay) : delay;
};
