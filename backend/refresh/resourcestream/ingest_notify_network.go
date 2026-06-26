/*
 * backend/refresh/resourcestream/ingest_notify_network.go
 *
 * The bespoke network kinds' live-stream change signal, sourced from the owned-reflector
 * ingest manager. Service and EndpointSlice have no streamspec.Descriptor (a Service's
 * namespace-network row is the bespoke Service↔EndpointSlice join, and EndpointSlice is both
 * its own row and that join input), so the generic registerIngestNotifyStreams does not cover
 * them — exactly like pods and the workload kinds. namespace-network is signal-only: the
 * broadcast ships only the change signal (Ref + ResourceVersion), never the projected row
 * (newObjectRowUpdate drops it), so the projected catalog Summary — which carries the
 * kind/identity/namespace/name/uid/resourceVersion — is all the signal needs.
 *
 * Both kinds broadcast on the SAME domain (namespace-network) and the SAME namespace scope,
 * so an EndpointSlice change already refetches every Service row in the namespace (the
 * owning Service's endpoint count is re-read by that namespace-scoped refetch). No separate
 * derived per-Service signal is needed — the typed broadcastServiceFromEndpointSlice fan-out
 * existed only because the typed handler computed (and discarded) a Service row; the
 * query-backed refetch covers it. Ingress and NetworkPolicy ARE Stream-backed, so their
 * notify is wired by the generic registerIngestNotifyStreams.
 */

package resourcestream

import (
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	endpointslicepkg "github.com/luxury-yacht/app/backend/resources/endpointslice"
	servicepkg "github.com/luxury-yacht/app/backend/resources/service"
)

// registerNetworkIngestNotify wires the direct change signal for the two bespoke network
// kinds (Service, EndpointSlice) to the ingest manager's Catalog-half Sink, so no typed
// informer is created for the notify — the ingest twin of the typed handleService /
// handleEndpointSlice via registerNetworkStreams. Each Upsert/Delete broadcasts the same
// Ref/ResourceVersion change signal on namespace-network that the typed handler did.
// ingestManager may be nil (a unit test), a no-op then.
func (m *Manager) registerNetworkIngestNotify(ingestManager *ingest.IngestManager) {
	if m == nil || ingestManager == nil {
		return
	}
	for _, ident := range []resourcekind.Identity{servicepkg.Identity, endpointslicepkg.Identity} {
		if !m.canListWatch(ident.Group, ident.Resource) {
			continue
		}
		ingestManager.AddCatalogSink(ident.GVR(), networkNotifyCatalogSink{manager: m, identity: ident})
	}
}

// networkNotifyCatalogSink adapts the namespace-network signal-only broadcast to an ingest
// Catalog-half Sink. The reflector delivers the projected catalog Summary (never the source
// object), which carries every identity field the change signal needs. Upsert fires a
// MODIFIED signal and Delete a DELETED signal — the same Add/Update/Delete -> broadcast
// mapping the typed handlers applied, collapsed to the two events a Sink exposes
// (equivalent to the consumer, which advances sourceVersion on any signal and never reads
// Update.Type for this query-backed domain).
type networkNotifyCatalogSink struct {
	manager  *Manager
	identity resourcekind.Identity
}

func (s networkNotifyCatalogSink) Upsert(row interface{}) {
	s.broadcast(row, MessageTypeModified)
}

func (s networkNotifyCatalogSink) Delete(row interface{}) {
	s.broadcast(row, MessageTypeDeleted)
}

func (s networkNotifyCatalogSink) broadcast(row interface{}, updateType MessageType) {
	summary, ok := row.(objectcatalog.Summary)
	if !ok {
		return
	}
	ref := resourcemodel.NewResourceRef(
		s.manager.clusterMeta.ClusterID,
		s.identity.Group, s.identity.Version, s.identity.Kind, s.identity.Resource,
		summary.Namespace, summary.Name, summary.UID,
	)
	update := Update{
		Type:            updateType,
		Domain:          domainNamespaceNetwork,
		ClusterID:       s.manager.clusterMeta.ClusterID,
		ClusterName:     s.manager.clusterMeta.ClusterName,
		ResourceVersion: summary.ResourceVersion,
		Ref:             &ref,
	}
	s.manager.broadcast(domainNamespaceNetwork, scopesForNamespace(summary.Namespace), update)
}
