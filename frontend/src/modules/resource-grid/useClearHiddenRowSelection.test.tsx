import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localFailure, type RefreshFailure } from '@/core/refresh/refreshFailure';
import { useClearHiddenRowSelection } from './useClearHiddenRowSelection';

interface Row {
  name: string;
}

type Source = { rows: Row[]; loaded: boolean; loading: boolean; error: RefreshFailure | null };

const keyExtractor = (row: Row) => row.name;

describe('useClearHiddenRowSelection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const onClear = vi.fn();

  const Probe = ({ selectedKeys, source }: { selectedKeys: string[]; source: Source }) => {
    useClearHiddenRowSelection({ selectedKeys, source, keyExtractor, onClear });
    return null;
  };

  const render = (selectedKeys: string[], source: Source) => {
    act(() => {
      root.render(<Probe selectedKeys={selectedKeys} source={source} />);
    });
  };

  const settled = (rows: Row[]): Source => ({ rows, loaded: true, loading: false, error: null });

  beforeEach(() => {
    container = document.createElement('div');
    root = ReactDOM.createRoot(container);
    onClear.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it('keeps a selection while its row is in the settled rows', () => {
    render(['api'], settled([{ name: 'api' }, { name: 'web' }]));
    expect(onClear).not.toHaveBeenCalled();
  });

  it('clears a selection once the settled rows no longer include it', () => {
    render(['api'], settled([{ name: 'api' }]));
    render(['api'], settled([{ name: 'web' }]));
    expect(onClear).toHaveBeenCalledExactlyOnceWith(['api']);
  });

  it('clears only the selected rows the settled rows no longer include', () => {
    const keys = ['api', 'web', 'db'];
    render(keys, settled([{ name: 'api' }, { name: 'web' }, { name: 'db' }]));
    render(keys, settled([{ name: 'web' }]));
    expect(onClear).toHaveBeenCalledExactlyOnceWith(['api', 'db']);
  });

  it.each<[string, Source]>([
    ['before the first load', { rows: [], loaded: false, loading: true, error: null }],
    ['while a refetch is in flight', { rows: [], loaded: true, loading: true, error: null }],
    [
      'when the refetch failed',
      { rows: [], loaded: true, loading: false, error: localFailure('denied') },
    ],
  ])('keeps the selection %s', (_label, source) => {
    render(['api'], source);
    expect(onClear).not.toHaveBeenCalled();
  });
});
