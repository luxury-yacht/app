import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClearHiddenRowSelection } from './useClearHiddenRowSelection';

interface Row {
  name: string;
}

type Source = { rows: Row[]; loaded: boolean; loading: boolean; error: string | null };

const keyExtractor = (row: Row) => row.name;

describe('useClearHiddenRowSelection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const onClear = vi.fn();

  const Probe = ({ selectedKey, source }: { selectedKey: string | null; source: Source }) => {
    useClearHiddenRowSelection({ selectedKey, source, keyExtractor, onClear });
    return null;
  };

  const render = (selectedKey: string | null, source: Source) => {
    act(() => {
      root.render(<Probe selectedKey={selectedKey} source={source} />);
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
    render('api', settled([{ name: 'api' }, { name: 'web' }]));
    expect(onClear).not.toHaveBeenCalled();
  });

  it('clears a selection once the settled rows no longer include it', () => {
    render('api', settled([{ name: 'api' }]));
    render('api', settled([{ name: 'web' }]));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it.each([
    ['before the first load', { rows: [], loaded: false, loading: true, error: null }],
    ['while a refetch is in flight', { rows: [], loaded: true, loading: true, error: null }],
    ['when the refetch failed', { rows: [], loaded: true, loading: false, error: 'denied' }],
  ])('keeps the selection %s', (_label, source) => {
    render('api', source);
    expect(onClear).not.toHaveBeenCalled();
  });
});
