/**
 * frontend/src/hooks/useTableSort.test.tsx
 *
 * Test suite for useTableSort.
 * Covers key behaviors and edge cases for useTableSort.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { useTableSort } from './useTableSort';

type Row = {
  name: string;
  age?: string;
  value: number;
};

const rows: Row[] = [
  { name: 'charlie', age: '2h', value: 3 },
  { name: 'alpha', age: '30m', value: 1 },
  { name: 'bravo', age: undefined, value: 2 },
];

const TestHarness = ({ data }: { data: Row[] }) => {
  const { sortedData, sortConfig, handleSort } = useTableSort<Row>(data, 'name');

  return (
    <div>
      <button data-testid="sort-name" onClick={() => handleSort('name')}>
        sort-name
      </button>
      <button data-testid="sort-age" onClick={() => handleSort('age')}>
        sort-age
      </button>
      <div data-testid="names">{sortedData.map((item) => item.name).join(',')}</div>
      <div data-testid="ages">{sortedData.map((item) => item.age ?? '-').join(',')}</div>
      <div data-testid="direction">{sortConfig.direction ?? 'none'}</div>
    </div>
  );
};

describe('useTableSort', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderHarness = async (data = rows) => {
    await act(async () => {
      root.render(<TestHarness data={data} />);
      await Promise.resolve();
    });
  };

  const getText = (testId: string) =>
    container.querySelector(`[data-testid="${testId}"]`)?.textContent;

  it('sorts ascending by default and cycles direction on repeated toggles', async () => {
    await renderHarness();

    expect(getText('names')).toBe('alpha,bravo,charlie');
    expect(getText('direction')).toBe('asc');

    const sortNameButton = container.querySelector(
      '[data-testid="sort-name"]'
    ) as HTMLButtonElement;

    act(() => {
      sortNameButton.click();
    });
    expect(getText('names')).toBe('charlie,bravo,alpha');
    expect(getText('direction')).toBe('desc');

    act(() => {
      sortNameButton.click();
    });
    expect(getText('direction')).toBe('none');
  });

  it('uses column sortValue when columns option is provided', async () => {
    // Without sortValue, sorting by 'value' uses row.value (numeric).
    // With sortValue, we can invert the sort order as a proof that sortValue is called.
    type Item = { id: string; score: number };
    const items: Item[] = [
      { id: 'a', score: 10 },
      { id: 'b', score: 30 },
      { id: 'c', score: 20 },
    ];

    const columns = [
      // sortValue negates the score, so asc sort should produce descending score order.
      { key: 'score', sortValue: (item: Item) => -item.score },
    ];

    const SortValueHarness = () => {
      const { sortedData } = useTableSort<Item>(items, 'score', 'asc', { columns });
      return <div data-testid="ids">{sortedData.map((r) => r.id).join(',')}</div>;
    };

    await act(async () => {
      root.render(<SortValueHarness />);
    });

    // With negated sortValue, asc sort gives: b(−30) < c(−20) < a(−10) → b,c,a
    expect(getText('ids')).toBe('b,c,a');
  });

  it('falls back to row[key] when column has no sortValue', async () => {
    type Item = { id: string; score: number };
    const items: Item[] = [
      { id: 'a', score: 10 },
      { id: 'b', score: 30 },
      { id: 'c', score: 20 },
    ];

    // Column exists but has no sortValue — should use row.score directly.
    const columns = [{ key: 'score' }];

    const FallbackHarness = () => {
      const { sortedData } = useTableSort<Item>(items, 'score', 'asc', { columns });
      return <div data-testid="ids">{sortedData.map((r) => r.id).join(',')}</div>;
    };

    await act(async () => {
      root.render(<FallbackHarness />);
    });

    // Direct row.score asc: 10 < 20 < 30 → a,c,b
    expect(getText('ids')).toBe('a,c,b');
  });

  it('sorts age strings using duration-aware parsing', async () => {
    await renderHarness();

    const sortAgeButton = container.querySelector('[data-testid="sort-age"]') as HTMLButtonElement;

    act(() => {
      sortAgeButton.click();
    });

    expect(getText('names')).toBe('alpha,charlie,bravo');
    expect(getText('ages')).toBe('30m,2h,-');
    expect(getText('direction')).toBe('asc');

    act(() => {
      sortAgeButton.click();
    });
    expect(getText('names')).toBe('charlie,alpha,bravo');
    expect(getText('direction')).toBe('desc');
  });
});
