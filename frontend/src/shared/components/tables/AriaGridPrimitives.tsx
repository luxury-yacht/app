import type React from 'react';
import { forwardRef } from 'react';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/** Focus owner for a virtualized grid whose rows may be recycled. */
export const AriaGrid = forwardRef<HTMLDivElement, DivProps>(function AriaGrid(props, ref) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: Native table layout cannot represent this recycled, independently scrolling virtual grid; this shared primitive centralizes that documented exception.
    <div {...props} ref={ref} role="grid" />
  );
});

/** Row collection inside a virtualized ARIA grid. */
export const AriaGridRowGroup = forwardRef<HTMLDivElement, DivProps>(
  function AriaGridRowGroup(props, ref) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: Native tbody requires a native table ancestry that is incompatible with the recycled virtual-grid layout.
      <div {...props} ref={ref} role="rowgroup" />
    );
  }
);

/** Non-tabbable row owned by the grid's aria-activedescendant focus model. */
export const AriaGridRow = forwardRef<HTMLDivElement, DivProps>(function AriaGridRow(props, ref) {
  return (
    // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements: Rows are intentionally non-tabbable descendants of the virtual grid's single focus owner; native tr cannot support this layout outside a table.
    <div {...props} ref={ref} role="row" />
  );
});

/** Header cell for the independently scrolling virtual-grid header. */
export const AriaGridColumnHeader = forwardRef<HTMLDivElement, DivProps>(
  function AriaGridColumnHeader(props, ref) {
    return (
      // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements: Sorting and resizing are owned by nested native controls; the header itself is not a tab stop and cannot be a native th outside table layout.
      <div {...props} ref={ref} role="columnheader" />
    );
  }
);

/** Non-tabbable cell inside a row-focused virtual grid. */
export const AriaGridCell = forwardRef<HTMLDivElement, DivProps>(function AriaGridCell(props, ref) {
  return (
    // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements: Cell content may contain native controls, while row navigation remains on the grid focus owner; native td cannot support this layout outside a table.
    <div {...props} ref={ref} role="gridcell" />
  );
});
