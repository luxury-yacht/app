# GridTable Custom Metadata Columns

Read when adding or changing user-defined label/annotation columns. Apply
[shared table rules](gridtable.md), and use [column definitions and persistence](gridtable-columns.md)
when changing the common column model.

- Resource tables may add custom metadata columns through the Columns menu.
  Every resource table must explicitly declare `supportsCustomMetadataColumns`.
  Set it to `true` only when the row producer carries Kubernetes labels or
  annotations through `metadata` or the supported top-level compatibility
  fields. Set it to `false` for projected row types without metadata so the
  Columns menu omits the dead-end Add action. Shared and query-backed wrappers
  forward this caller-owned capability; they must not infer it from table mode.
  `Add` closes the Columns menu and opens the shared editor with the distinct
  metadata keys available in the table's loaded rows. One searchable picker
  presents Labels and Annotations as separate groups; the user selects an exact
  key instead of typing one. Selecting a key shows up to three distinct values
  sampled from the loaded rows. If no metadata keys are available, the editor
  keeps the full-width picker disabled with `No metadata keys available`,
  explains that state beneath the field, and disables creation. Custom rows
  expose Edit and a direct Delete action beside the reorder grip; editing can
  rename or explicitly remove the definition. Hiding and removing are separate
  operations.
- A custom metadata column's durable key is
  `metadata:<label|annotation>:<exact-metadata-key>`. Its heading is presentation
  only, so renaming must preserve width, order, visibility, and favorite
  references. The same source/key pair may appear only once in a table scope;
  a label and annotation with the same key are distinct definitions.
- Custom metadata columns are hideable, resizable, automatic-width, appended on
  creation, and deliberately non-sortable. Query-backed sorting must not claim
  to order the complete result by an arbitrary metadata key until the provider
  implements that contract. A missing key returns `undefined` and uses the
  shared `-` placeholder; a present empty string remains an explicitly present,
  blank value.
- Persist custom definitions with the table's existing
  cluster/view/namespace key and restore them before pruning column order,
  visibility, or width state. Columns Reset clears presentation state while
  preserving definitions. Favorites may reference a durable custom key but do
  not own or recreate its definition; a deleted definition is ignored when a
  favorite is applied.
