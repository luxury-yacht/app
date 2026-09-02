import { describe, expect, it } from 'vitest';
import { resolveObjectPanelOpenTarget } from './objectPanelOpenTarget';

describe('resolveObjectPanelOpenTarget', () => {
  it('opens a new default-floating panel in its own floating group', () => {
    expect(resolveObjectPanelOpenTarget('floating', undefined, () => 'right')).toEqual({
      groupKey: 'floating',
      position: 'floating',
    });
  });

  it('preserves an explicit group selection', () => {
    expect(resolveObjectPanelOpenTarget('floating', 'bottom', () => 'right')).toEqual({
      groupKey: 'bottom',
      position: 'bottom',
    });
  });
});
