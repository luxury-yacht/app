/*
 * backend/refresh/resourcestream/ingest_notify_workloads.go
 *
 * The workload kinds' live-stream change signal, sourced from the owned-reflector ingest
 * manager. Deployment/StatefulSet/DaemonSet/Job/CronJob have no streamspec.Descriptor (the
 * workloads table is the bespoke cross-kind WorkloadSummary), so the generic
 * registerIngestNotifyStreams does not cover them — exactly like pods. namespace-workloads
 * is signal-only: handleWorkload emits only the change signal (Ref + ResourceVersion) and
 * the query-backed table refetches, so the projected catalog Summary (which carries the
 * kind/identity/namespace/name/uid/resourceVersion) is all the signal needs.
 *
 * Two paths read the workload ingest store here:
 *   - a per-kind Catalog-half notify Sink fires the direct workload-change signal (the
 *     ingest twin of the typed handleWorkload), registered for each cut workload kind;
 *   - lookupWorkloadRef resolves a workload's identity Ref by namespace/name for the
 *     by-key notify paths (the HPA->workload signal and the pod-owner->workload signal),
 *     reading the catalog half's UID — the ingest replacement for a typed lister Get.
 */

package resourcestream

import (
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// workloadBundleSource supplies the cut workload kinds' projected bundles for the manager's
// by-key lookups (the HPA->workload and pod-owner->workload notify paths need a specific
// workload's UID + namespace/name, which the projected bundle's Catalog half carries).
// *ingest.IngestManager satisfies it.
type workloadBundleSource interface {
	Rows(gvr schema.GroupVersionResource) []interface{}
}

// workloadIdentityForKind maps a workload kind string to its canonical Identity and GVR,
// or reports false for a non-workload kind. It is the one place the workload notify resolves
// a kind name to its ingest store key + Ref fields.
func workloadIdentityForKind(kind string) (resourcekind.Identity, schema.GroupVersionResource, bool) {
	switch kind {
	case deployment.Identity.Kind:
		return deployment.Identity, snapshot.DeploymentGVR, true
	case statefulset.Identity.Kind:
		return statefulset.Identity, snapshot.StatefulSetGVR, true
	case daemonset.Identity.Kind:
		return daemonset.Identity, snapshot.DaemonSetGVR, true
	case jobres.Identity.Kind:
		return jobres.Identity, snapshot.JobGVR, true
	case cronjob.Identity.Kind:
		return cronjob.Identity, snapshot.CronJobGVR, true
	default:
		return resourcekind.Identity{}, schema.GroupVersionResource{}, false
	}
}

// lookupWorkloadRef resolves the identity Ref of the workload kind/namespace/name. It
// prefers a typed lister when one is wired (the unit-test path that drives the typed
// handlers directly), and otherwise reads the workload's UID from the ingest store's
// projected catalog half (the production path — the workload kinds are cut, so no typed
// lister exists). It reports false when neither source has the workload, matching the typed
// lister Get-error skip the callers already applied.
func (m *Manager) lookupWorkloadRef(kind, namespace, name string) (resourcemodel.ResourceRef, bool) {
	identity, gvr, ok := workloadIdentityForKind(kind)
	if !ok {
		return resourcemodel.ResourceRef{}, false
	}
	// Test path: a wired typed lister resolves the object (and its UID) directly.
	if obj, err := m.lookupWorkloadObject(kind, namespace, name); err == nil && obj != nil {
		return resourcemodel.NewResourceRef(
			m.clusterMeta.ClusterID,
			identity.Group, identity.Version, identity.Kind, identity.Resource,
			obj.GetNamespace(), obj.GetName(), string(obj.GetUID()),
		), true
	}
	// Production path: read the projected catalog half (UID) from the ingest store.
	if m.workloadIngest == nil {
		return resourcemodel.ResourceRef{}, false
	}
	for _, raw := range m.workloadIngest.Rows(gvr) {
		bundle, ok := raw.(ingest.Bundle)
		if !ok {
			continue
		}
		catalog, ok := bundle.Catalog.(objectcatalog.Summary)
		if !ok || catalog.Namespace != namespace || catalog.Name != name {
			continue
		}
		return resourcemodel.NewResourceRef(
			m.clusterMeta.ClusterID,
			identity.Group, identity.Version, identity.Kind, identity.Resource,
			catalog.Namespace, catalog.Name, catalog.UID,
		), true
	}
	return resourcemodel.ResourceRef{}, false
}

// registerWorkloadIngestNotify wires the direct workload-change signal for each cut workload
// kind to the ingest manager's Catalog-half Sink, so no typed informer is created for the
// notify — the ingest twin of the typed handleWorkload via registerWorkloadStreams. Each
// Upsert/Delete broadcasts the same Ref/ResourceVersion change signal on the workloads
// domain that the typed handler did. ingestManager may be nil (a unit test), a no-op then.
func (m *Manager) registerWorkloadIngestNotify(ingestManager *ingest.IngestManager) {
	if m == nil || ingestManager == nil {
		return
	}
	for _, kind := range []string{
		deployment.Identity.Kind, statefulset.Identity.Kind, daemonset.Identity.Kind,
		jobres.Identity.Kind, cronjob.Identity.Kind,
	} {
		identity, gvr, ok := workloadIdentityForKind(kind)
		if !ok {
			continue
		}
		if !m.canListWatch(identity.Group, identity.Resource) {
			continue
		}
		ingestManager.AddCatalogSink(gvr, workloadNotifyCatalogSink{manager: m, identity: identity})
	}
}

// workloadNotifyCatalogSink adapts the workloads signal-only broadcast to an ingest
// Catalog-half Sink. The reflector delivers the projected catalog Summary (never the source
// object), which carries every identity field the workloads change signal needs. Upsert
// fires a MODIFIED signal and Delete a DELETED signal — the same Add/Update/Delete ->
// broadcast mapping the typed handleWorkload applied, collapsed to the two events a Sink
// exposes to advance the consumer's sourceVersion refetch signal.
type workloadNotifyCatalogSink struct {
	manager  *Manager
	identity resourcekind.Identity
}

func (s workloadNotifyCatalogSink) Upsert(row interface{}) {
	s.broadcast(row, MessageTypeModified)
}

func (s workloadNotifyCatalogSink) Delete(row interface{}) {
	s.broadcast(row, MessageTypeDeleted)
}

func (s workloadNotifyCatalogSink) broadcast(row interface{}, updateType MessageType) {
	summary, ok := row.(objectcatalog.Summary)
	if !ok {
		return
	}
	ref := resourcemodel.NewResourceRef(
		s.manager.clusterMeta.ClusterID,
		s.identity.Group, s.identity.Version, s.identity.Kind, s.identity.Resource,
		summary.Namespace, summary.Name, summary.UID,
	)
	s.manager.broadcastWorkloadNotificationRef(ref, summary.Namespace, summary.ResourceVersion, updateType)
}
