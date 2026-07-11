import type React from 'react';
import { forwardRef } from 'react';

type TableProps = React.TableHTMLAttributes<HTMLTableElement>;
type RowGroupProps = React.HTMLAttributes<HTMLTableSectionElement>;
type RowProps = React.HTMLAttributes<HTMLTableRowElement>;
type HeaderProps = React.ThHTMLAttributes<HTMLTableCellElement>;
type CellProps = React.TdHTMLAttributes<HTMLTableCellElement>;

/** Native focus owner for a virtualized table whose rows may be recycled. */
export const AriaGrid = forwardRef<HTMLTableElement, TableProps>(
  function AriaGridComponent(props, ref) {
    return <table {...props} ref={ref} />;
  }
);

/** Row collection inside a virtualized ARIA grid. */
export const AriaGridRowGroup = forwardRef<HTMLTableSectionElement, RowGroupProps>(
  function AriaGridRowGroupComponent(props, ref) {
    return <tbody {...props} ref={ref} />;
  }
);

/** Native row owned by the table-level keyboard focus model. */
export const AriaGridRow = forwardRef<HTMLTableRowElement, RowProps>(
  function AriaGridRowComponent(props, ref) {
    return <tr {...props} ref={ref} />;
  }
);

/** Native header cell for the independently scrolling table header. */
export const AriaGridColumnHeader = forwardRef<HTMLTableCellElement, HeaderProps>(
  function AriaGridColumnHeaderComponent(props, ref) {
    return <th {...props} ref={ref} scope="col" />;
  }
);

/** Native data cell inside a row-focused virtual table. */
export const AriaGridCell = forwardRef<HTMLTableCellElement, CellProps>(
  function AriaGridCellComponent(props, ref) {
    return <td {...props} ref={ref} />;
  }
);
