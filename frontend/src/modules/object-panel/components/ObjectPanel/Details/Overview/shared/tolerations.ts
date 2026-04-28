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
export const DEFAULT_TOLERATION_RE =
  /^node\.kubernetes\.io\/(not-ready|unreachable) Exists \(NoExecute\) for \d+s$/;

export interface ParsedToleration {
  label: string;
  tooltip?: string;
}

export const parseToleration = (raw: string): ParsedToleration | null => {
  let remaining = raw.trim();
  if (!remaining) return null;

  let seconds: string | undefined;
  const secondsMatch = remaining.match(/\s+for\s+(\d+)s$/);
  if (secondsMatch) {
    seconds = secondsMatch[1];
    remaining = remaining.slice(0, secondsMatch.index).trim();
  }

  let effect: string | undefined;
  const effectMatch = remaining.match(/\s*\(([^)]+)\)$/);
  if (effectMatch) {
    effect = effectMatch[1];
    remaining = remaining.slice(0, effectMatch.index).trim();
  }

  let key: string | undefined;
  let value: string | undefined;
  if (remaining !== 'Exists') {
    const parts = remaining.split(/\s+/);
    key = parts[0];
    value = parts[2];
  }

  const label = !key ? 'Exists' : key + (value ? `=${value}` : '') + (effect ? `:${effect}` : '');

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
