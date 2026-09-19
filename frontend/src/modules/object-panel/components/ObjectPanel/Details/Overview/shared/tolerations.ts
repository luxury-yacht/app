/**
 * Shared toleration parser used by Pod and Workload overviews.
 *
 * Backend tolerations arrive as preformatted strings, e.g.
 *   "node-role.kubernetes.io/control-plane Equal master (NoSchedule) for 60s"
 *   "custom-taint Exists (NoExecute)"
 *   "Exists"  (operator-only, matches any taint)
 *
 * We compress to taint-shape (`key[=value][:effect]`) for the chip label and
 * push the rest into a tooltip.
 */

// The DefaultTolerationSeconds admission controller silently injects these
// two tolerations into virtually every pod, so they're noise rather than
// signal. Filter only the timed variant — the un-timed form (added by the
// DaemonSet controller) still surfaces, since it tells you the pod is a
// DaemonSet.
const DEFAULT_TOLERATION_RE =
  /^node\.kubernetes\.io\/(not-ready|unreachable) Exists \(NoExecute\) for \d+s$/;

export interface ParsedToleration {
  label: string;
  tooltip?: string;
}

const extractTimedSuffix = (value: string): { remaining: string; seconds: string | undefined } => {
  if (!value.endsWith('s')) {
    return { remaining: value, seconds: undefined };
  }

  let cursor = value.length - 1;
  const secondsEnd = cursor;
  while (cursor > 0 && value[cursor - 1] >= '0' && value[cursor - 1] <= '9') {
    cursor -= 1;
  }
  if (cursor === secondsEnd) {
    return { remaining: value, seconds: undefined };
  }
  const secondsStart = cursor;

  const whitespaceAfterForEnd = cursor;
  while (cursor > 0 && value[cursor - 1]?.trim() === '') {
    cursor -= 1;
  }
  if (cursor === whitespaceAfterForEnd || value.slice(Math.max(0, cursor - 3), cursor) !== 'for') {
    return { remaining: value, seconds: undefined };
  }
  cursor -= 3;

  const whitespaceBeforeForEnd = cursor;
  while (cursor > 0 && value[cursor - 1]?.trim() === '') {
    cursor -= 1;
  }
  if (cursor === whitespaceBeforeForEnd) {
    return { remaining: value, seconds: undefined };
  }

  return {
    remaining: value.slice(0, cursor).trim(),
    seconds: value.slice(secondsStart, secondsEnd),
  };
};

const extractEffectSuffix = (value: string): { remaining: string; effect: string | undefined } => {
  if (!value.endsWith(')')) {
    return { remaining: value, effect: undefined };
  }
  const openingParenthesis = value.lastIndexOf('(');
  if (openingParenthesis === -1 || openingParenthesis === value.length - 2) {
    return { remaining: value, effect: undefined };
  }
  return {
    remaining: value.slice(0, openingParenthesis).trim(),
    effect: value.slice(openingParenthesis + 1, -1),
  };
};

export const parseToleration = (raw: string): ParsedToleration | null => {
  let remaining = raw.trim();
  if (!remaining) {
    return null;
  }

  const timedSuffix = extractTimedSuffix(remaining);
  const seconds = timedSuffix.seconds;
  remaining = timedSuffix.remaining;

  const effectSuffix = extractEffectSuffix(remaining);
  const effect = effectSuffix.effect;
  remaining = effectSuffix.remaining;

  let key: string | undefined;
  let value: string | undefined;
  if (remaining !== 'Exists') {
    const parts = remaining.split(/\s+/);
    key = parts[0];
    value = parts[2];
  }

  let label: string;

  if (!key) {
    label = 'Exists';
  } else {
    label = key + (value ? `=${value}` : '') + (effect ? `:${effect}` : '');
  }

  const tooltipParts: string[] = [];
  if (!key) {
    tooltipParts.push('Tolerates any taint. Can deploy to any node.');
  } else if (!value) {
    tooltipParts.push('Tolerates any value for this key.');
  }
  if (key && !effect) {
    tooltipParts.push('Tolerates any effect.');
  }
  if (seconds) {
    tooltipParts.push(`Pod evicted after ${seconds}s if a matching taint persists.`);
  }
  const tooltip = tooltipParts.length > 0 ? tooltipParts.join(' ') : undefined;

  return { label, tooltip };
};

export const nonDefaultTolerations = (
  tolerations: string[] | null | undefined
): ParsedToleration[] =>
  tolerations
    ?.filter((toleration) => !DEFAULT_TOLERATION_RE.test(toleration))
    .map(parseToleration)
    .filter((toleration): toleration is ParsedToleration => toleration !== null) ?? [];
