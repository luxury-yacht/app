# GridTable Column Sizing

Use for width measurement, auto-width, or resizing changes. Apply the
[shared GridTable contract](gridtable.md) and preserve
[column definition and persistence rules](gridtable-columns.md#column-definitions).

## Column sizing

Auto-width dirty checking hashes the currently rendered cells before running column measurement.
When row virtualization changes `virtualRange.start/end`, the controller must enqueue visible
auto-width columns after the new row window commits; the range bounds are intentional effect
invalidators even though the callback does not read them.

Auto-width measurement considers every row in GridTable's current data page. Do not cap or stride
that input: a skipped row can contain the widest value. A column may use `measurementSampleKey` to
deduplicate rows only when the key guarantees equivalent rendered width. Replacing the current page
forces every non-user-sized `autoWidth` column to recompute in both directions; a wider prior page
must not become the minimum width for later pages. This replacement-page pass reads the data page
directly after render and must not depend on a visible-cell signature because virtualization or a
loading transition can temporarily leave no rendered cells. Measurements from
`getBoundingClientRect()` are visual pixels and must be converted back to unzoomed CSS pixels before
becoming a column width. Intrinsic measurements reserve one additional CSS pixel so subpixel paint
rounding cannot clip the content edge.

Measurement must not mount cell components or run their effects. Plain composite values declare
`measurementText`; composites whose wrapper styling changes box width declare an inert
`measurementElement` with the same host tag and classes as the rendered wrapper. Keep that markup
derived from the same presentation helpers as the live component so padding, borders, font, and text
transform stay synchronized.

Column widths come from persisted user state, the column definition, auto-width
measurement, or the shared fallback. The table does not stretch columns to fill
the viewport; narrower tables leave trailing space and wider tables scroll
horizontally. Resizing affects only the declared column and respects its
`minWidth`, `maxWidth`, and `resizable` capability.

When a column changes from declared fixed sizing to automatic sizing, its fresh
measurement replaces persisted column-owned widths. Only widths whose persisted
source is `user` remain fixed after that declaration change.
