/*
 * backend/refresh/resourcestream/ingest_notify.go
 *
 * The signal-only change signal for ingest-owned (cut) kinds, sourced from the
 * owned-reflector ingest manager instead of a typed shared informer.
 *
 * Every streamed table is query-backed: the live subscription exists only to learn
 * WHEN to refetch, so the broadcast ships only the change signal (Ref + ResourceVersion),
 * never the projected row (see newObjectRowUpdate). For most kinds that signal is
 * driven by a shared-informer event handler (registerDescriptorStreams). For an
 * IngestOwned kind the shared factory no longer caches the typed object, so creating
 * that informer purely for the signal would defeat the per-kind memory win. Instead
 * the ingest reflector's Catalog-half Sink drives the exact same broadcast: the
 * Catalog Summary carries the kind/identity/namespace/name/uid/resourceVersion the
 * informer handler derived from the typed object, so the emitted Update is identical.
 */

package resourcestream

import (
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// registerIngestNotifyStreams wires the signal-only change signal for every
// IngestOwned descriptor to the ingest manager's Catalog-half Sink, so no typed
// informer is created for those kinds. It is the ingest twin of
// registerDescriptorStreams (which skips IngestOwned kinds): a streamed descriptor is
// served by exactly one of the two — the informer handler for uncut kinds, this sink
// for cut kinds. ingestManager may be nil (a unit test with no cut kinds wired), in
// which case this is a no-op. Sinks are registered before the manager starts, so the
// initial relist's Upserts fire the signal exactly as an informer's initial Add would.
func (m *Manager) registerIngestNotifyStreams(ingestManager *ingest.IngestManager) {
	if m == nil || ingestManager == nil {
		return
	}
	ingestOwned := kindregistry.IngestOwnedGVRs()
	for _, d := range kindregistry.StreamDescriptors() {
		if _, owned := ingestOwned[d.GVR()]; !owned {
			continue
		}
		if !m.canListWatch(d.Group, d.Resource) {
			continue
		}
		ingestManager.AddCatalogSink(d.GVR(), m.ingestNotifySink(d))
	}
}

// ingestNotifySink returns an ingest Catalog-half Sink that broadcasts the
// signal-only change signal for one IngestOwned descriptor. Upsert fires a MODIFIED
// signal (the row may have changed) and Delete a DELETED signal — the same Add/
// Update/Delete → broadcast mapping the shared-informer handler applied, collapsed to
// the two events a Sink exposes. The frontend advances sourceVersion on any signal and
// never reads Update.Type for these query-backed domains, so collapsing Add+Update to
// MODIFIED is equivalent to the consumer. The catalog half's incremental replay on
// registration (AddCatalogSink re-Upserts the already-ingested set) means a sink
// registered after the reflector started still signals the current set, matching an
// informer's re-delivery of its store to a late handler.
func (m *Manager) ingestNotifySink(d streamspec.Descriptor) ingest.Sink {
	return ingestNotifySink{manager: m, desc: d}
}

// ingestNotifySink adapts the signal-only broadcast to an ingest.Sink. The reflector
// delivers the projected catalog Summary (never the source object), which carries
// every identity field the broadcast needs.
type ingestNotifySink struct {
	manager *Manager
	desc    streamspec.Descriptor
}

func (s ingestNotifySink) Upsert(row interface{}) {
	s.broadcastSignal(row, MessageTypeModified)
}

func (s ingestNotifySink) Delete(row interface{}) {
	s.broadcastSignal(row, MessageTypeDeleted)
}

// broadcastSignal emits the signal-only Update for one catalog Summary on the
// descriptor's domain and scope, identically to streamObjectRowFromDescriptor's
// broadcast: a Ref + ResourceVersion change signal with no Row, scoped to the object's
// namespace (namespaced kinds) or the cluster (cluster-scoped kinds).
func (s ingestNotifySink) broadcastSignal(row interface{}, updateType MessageType) {
	summary, ok := row.(objectcatalog.Summary)
	if !ok {
		return
	}
	d := s.desc
	ref := resourcemodel.NewResourceRef(
		s.manager.clusterMeta.ClusterID,
		d.Group, d.Version, d.Kind, d.Resource,
		summary.Namespace, summary.Name, summary.UID,
	)
	update := Update{
		Type:            updateType,
		Domain:          d.Domain,
		ClusterID:       s.manager.clusterMeta.ClusterID,
		ClusterName:     s.manager.clusterMeta.ClusterName,
		ResourceVersion: summary.ResourceVersion,
		Ref:             &ref,
	}
	scopes := scopesForCluster()
	if !d.ClusterScoped {
		scopes = scopesForNamespace(summary.Namespace)
	}
	s.manager.broadcast(d.Domain, scopes, update)
}
