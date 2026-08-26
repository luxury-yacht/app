import { reorderVisibleColumnOrder } from '@shared/components/tables/gridTableColumnOrder';
import { describe, expect, it } from 'vitest';

describe('reorderVisibleColumnOrder', () => {
  it('does not rewrite hidden-column placement for a visually unchanged drop', () => {
    expect(reorderVisibleColumnOrder(['A', 'hidden', 'B'], 'A', ['A', 'B'], 1)).toBeNull();
    expect(reorderVisibleColumnOrder(['A', 'hidden', 'B'], 'B', ['A', 'B'], 1)).toBeNull();
  });

  it('maps a changed visible order into the complete order without dropping hidden keys', () => {
    expect(reorderVisibleColumnOrder(['A', 'hidden', 'B'], 'A', ['A', 'B'], 2)).toEqual([
      'hidden',
      'B',
      'A',
    ]);
    expect(reorderVisibleColumnOrder(['A', 'hidden', 'B'], 'B', ['A', 'B'], 0)).toEqual([
      'B',
      'A',
      'hidden',
    ]);
  });
});
