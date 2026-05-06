// Package snapshot builds refresh-domain payloads for list, table, object, and
// diagnostics views.
//
// Snapshot builders are the canonical source for UI list/table data. They build
// cluster-aware payloads for the refresh HTTP API and provide the baseline data
// used by streaming domains. Row-shaped payloads that are also updated by the
// resource stream must use the shared Build*Summary helpers so snapshot and
// streaming updates emit the same fields.
//
// Rich object details and imperative operations belong in backend/resources and
// are exposed to this package through providers such as ObjectDetailProvider.
package snapshot
