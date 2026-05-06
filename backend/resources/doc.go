// Package resources contains Kubernetes object detail and action services.
//
// The package is not the canonical source for list/table payloads. UI tables
// and refresh domains are built under backend/refresh/snapshot and, when live
// updates are needed, backend/refresh/resourcestream. This package owns
// request-shaped behavior: rich object details for the object panel, YAML and
// Helm backing helpers, log/debug helpers, and imperative operations such as
// delete-style actions.
//
// Callers must pass a cluster-scoped common.Dependencies value. Services in this
// package must not resolve or guess cluster identity on their own.
package resources
