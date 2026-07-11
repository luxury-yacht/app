import {
  type DependencyList,
  type EffectCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
} from 'react';

/**
 * Run an effect for its mount lifetime. The callback and cleanup intentionally
 * keep the values captured by the mounting render.
 */
export const useMountEffect = (effect: EffectCallback): void => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: this hook defines a mount-only lifetime and intentionally captures the mounting callback
  useEffect(effect, []);
};

/**
 * Run an effect when either a value it reads or an explicit invalidation token
 * changes. Invalidation tokens express lifecycle events that are not read by
 * the callback but must still restart the effect.
 */
export const useEffectWithInvalidation = (
  effect: EffectCallback,
  dependencies: DependencyList,
  invalidationTokens: DependencyList
): void => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the two lists form this hook's explicit read and invalidation contract
  useEffect(effect, [...dependencies, ...invalidationTokens]);
};

/**
 * Layout-effect counterpart to useEffectWithInvalidation for DOM measurements
 * that must be refreshed before paint.
 */
export const useLayoutEffectWithInvalidation = (
  effect: EffectCallback,
  dependencies: DependencyList,
  invalidationTokens: DependencyList
): void => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the two lists form this hook's explicit read and invalidation contract
  useLayoutEffect(effect, [...dependencies, ...invalidationTokens]);
};

/**
 * Recompute a memo when either a value its factory reads or an explicit
 * invalidation token changes.
 */
export const useMemoWithInvalidation = <T>(
  factory: () => T,
  dependencies: DependencyList,
  invalidationTokens: DependencyList
): T => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the two lists form this hook's explicit read and invalidation contract
  return useMemo(factory, [...dependencies, ...invalidationTokens]);
};
