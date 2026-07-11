import type React from 'react';
import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import {
  useEffectWithInvalidation,
  useLayoutEffectWithInvalidation,
  useMemoWithInvalidation,
  useMountEffect,
} from './useHookLifetimes';

describe('hook lifetime helpers', () => {
  it('reruns an effect when an invalidation-only value changes', () => {
    const effect = vi.fn<(value: string) => (() => void) | undefined>();
    const cleanup = vi.fn();
    effect.mockReturnValue(cleanup);
    let value = 'first';
    let revision = 0;

    const Harness: React.FC<{ value: string; revision: number }> = (props) => {
      useEffectWithInvalidation(() => effect(props.value), [props.value], [props.revision]);
      return null;
    };

    const container = document.createElement('div');
    const root = ReactDOM.createRoot(container);
    act(() => root.render(<Harness value={value} revision={revision} />));

    act(() => root.render(<Harness value={value} revision={revision} />));
    expect(effect).toHaveBeenCalledTimes(1);

    revision += 1;
    act(() => root.render(<Harness value={value} revision={revision} />));
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledTimes(2);

    value = 'second';
    act(() => root.render(<Harness value={value} revision={revision} />));
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(effect).toHaveBeenCalledTimes(3);

    act(() => root.unmount());
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it('recomputes a memo when an invalidation-only value changes', () => {
    const compute = vi.fn((value: string) => ({ value }));
    const value = 'first';
    let revision = 0;
    let result: { value: string } | undefined;

    const Harness: React.FC<{ value: string; revision: number }> = (props) => {
      result = useMemoWithInvalidation(() => compute(props.value), [props.value], [props.revision]);
      return null;
    };

    const container = document.createElement('div');
    const root = ReactDOM.createRoot(container);
    act(() => root.render(<Harness value={value} revision={revision} />));
    const initialResult = result;

    act(() => root.render(<Harness value={value} revision={revision} />));
    expect(result).toBe(initialResult);
    expect(compute).toHaveBeenCalledTimes(1);

    revision += 1;
    act(() => root.render(<Harness value={value} revision={revision} />));
    expect(result).not.toBe(initialResult);
    expect(compute).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });

  it('reruns a layout effect when an invalidation-only value changes', () => {
    const effect = vi.fn();
    let revision = 0;

    const Harness: React.FC = () => {
      useLayoutEffectWithInvalidation(effect, [], [revision]);
      return null;
    };

    const container = document.createElement('div');
    const root = ReactDOM.createRoot(container);
    act(() => root.render(<Harness />));
    act(() => root.render(<Harness />));
    expect(effect).toHaveBeenCalledTimes(1);

    revision += 1;
    act(() => root.render(<Harness />));
    expect(effect).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });

  it('runs a mount effect once and cleans it up on unmount', () => {
    const effect = vi.fn<() => (() => void) | undefined>();
    const cleanup = vi.fn();
    effect.mockReturnValue(cleanup);

    const Harness: React.FC<{ value: string }> = ({ value }) => {
      useMountEffect(() => effect());
      return <span>{value}</span>;
    };

    const container = document.createElement('div');
    const root = ReactDOM.createRoot(container);
    act(() => root.render(<Harness value="first" />));
    act(() => root.render(<Harness value="second" />));
    expect(effect).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
