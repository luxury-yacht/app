import type React from 'react';

type TableProps = React.TableHTMLAttributes<HTMLTableElement> & {
  ref?: React.Ref<HTMLTableElement>;
};
type RowGroupProps = React.HTMLAttributes<HTMLTableSectionElement> & {
  ref?: React.Ref<HTMLTableSectionElement>;
};
type RowProps = React.HTMLAttributes<HTMLTableRowElement> & {
  ref?: React.Ref<HTMLTableRowElement>;
};
type HeaderProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  ref?: React.Ref<HTMLTableCellElement>;
};
type CellProps = React.TdHTMLAttributes<HTMLTableCellElement> & {
  ref?: React.Ref<HTMLTableCellElement>;
};

/** Native focus owner for a virtualized table whose rows may be recycled. */
export const AriaGrid = function AriaGridComponent({ ref, ...props }: TableProps) {
  return <table {...props} ref={ref} />;
};

/** Row collection inside a virtualized ARIA grid. */
export const AriaGridRowGroup = function AriaGridRowGroupComponent({
  ref,
  ...props
}: RowGroupProps) {
  return <tbody {...props} ref={ref} />;
};

/** Native row owned by the table-level keyboard focus model. */
export const AriaGridRow = function AriaGridRowComponent({ ref, ...props }: RowProps) {
  return <tr {...props} ref={ref} />;
};

/** Native header cell for the independently scrolling table header. */
export const AriaGridColumnHeader = function AriaGridColumnHeaderComponent({
  ref,
  ...props
}: HeaderProps) {
  return <th {...props} ref={ref} scope="col" />;
};

/** Native data cell inside a row-focused virtual table. */
export const AriaGridCell = function AriaGridCellComponent({ ref, ...props }: CellProps) {
  return <td {...props} ref={ref} />;
};
