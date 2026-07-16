# Consistent Table No-Value Presentation

## Goal

Render every table cell that represents an absent value with the namespace
table convention: the ASCII hyphen-minus (`-`) in tertiary text color.

## Inventory

- Shared `GridTable` surfaces: all resource inventory tables, object-panel
  Events, and parsed logs flow through `useGridTableCellCache`.
- Shared column factories: text, age, namespace, and resource-bar columns can
  produce absent-value markers.
- Native data tables: refresh diagnostics, stream diagnostics, capability and
  permission diagnostics, table-performance diagnostics, Kubernetes API client
  diagnostics, broker-read diagnostics, and the drain progress pod table.
- Native table shells without absent-value cells: app logs, icon debug, and
  confirmation details.

## Implementation

- [ ] Add one shared no-value marker, detector, renderer, and tertiary-color
      class.
- [ ] Normalize legacy em-dash and canonical hyphen GridTable cell output in
      the shared cell cache.
- [ ] Apply the shared renderer to native table values that can be absent.
- [ ] Remove the namespace-table-only no-value style.
- [ ] Document the durable GridTable no-value contract.
- [ ] Add focused regression coverage and run `mage qc:prerelease`.
- [ ] Verify representative rendered resource and diagnostics tables.

