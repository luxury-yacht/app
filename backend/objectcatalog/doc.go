// Package objectcatalog discovers Kubernetes resources and maintains the
// in-memory catalog used for browsing and lookup.
//
// The catalog is the source of truth for cluster and namespace resource
// discovery. Refresh domains may query it to build browse/catalog payloads, and
// object/action paths may use it to resolve known resources, but catalog rows
// are discovery summaries rather than rich object detail payloads.
package objectcatalog
