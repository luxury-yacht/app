/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/shared/labelSelector.ts
 *
 * Display terms for a Kubernetes label selector, shared by every Overview that shows one.
 */

/** Structural label selector accepted from any generated DTO (bindings or refresh contracts). */
export interface LabelSelectorTermsSource {
  matchLabels?: Readonly<Record<string, string | undefined>> | null;
  matchExpressions?: ReadonlyArray<{
    key: string;
    operator: string;
    values?: readonly string[] | null;
  }> | null;
}

/**
 * One term per matchLabels entry ("key=value") and per expression ("key In a, b"). An empty result
 * means the selector has no requirements; callers decide what an absent versus empty selector means.
 */
export const labelSelectorTerms = (
  selector: LabelSelectorTermsSource | null | undefined
): string[] => {
  const terms = Object.entries(selector?.matchLabels ?? {}).map(
    ([key, value]) => `${key}=${value ?? ''}`
  );
  for (const expression of selector?.matchExpressions ?? []) {
    terms.push(
      [expression.key, expression.operator, expression.values?.join(', ')].filter(Boolean).join(' ')
    );
  }
  return terms;
};
