/**
 * frontend/src/shared/components/tables/rowDetailNavigation.ts
 *
 * Keyboard navigation between a table and the tables nested in its row
 * details. One highlight moves through the rows in screen order: a parent
 * row, then (when expanded) its nested table's rows, then the next parent row.
 */

import { createContext } from 'react';

/** Where the keyboard goes when it leaves a nested table for the parent's rows. */
export type RowDetailExit =
  | 'up'
  | 'down'
  | 'home'
  | 'end'
  | 'previous-parent-row'
  | 'next-parent-row';

/** How a parent moves the keyboard into the table nested in one of its details. */
export interface RowDetailNestedTable {
  /** Highlights the nested table's first or last row; false when it has no rows. */
  enter: (position: 'first' | 'last') => boolean;
}

/** What a parent table gives the table nested in one of its row details. */
export interface RowDetailNavigation {
  /** Whether this nested table holds the keyboard (and so the one highlight). */
  holdsKeyboard: boolean;
  /** Moves the keyboard out to the parent's rows. */
  exit: (direction: RowDetailExit) => void;
  /** Lets the parent move the keyboard into this nested table. */
  register: (table: RowDetailNestedTable | null) => void;
}

export const RowDetailNavigationContext = createContext<RowDetailNavigation | null>(null);
