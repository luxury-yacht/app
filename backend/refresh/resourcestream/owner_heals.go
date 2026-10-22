/*
 * backend/refresh/resourcestream/owner_heals.go
 *
 * Repairs stored pod bundles whose owner could not be resolved when they were
 * projected. The rewrite fans through the pod store's sinks like a reflector
 * update, so the pods table store publishes the healed row's old and new scopes.
 */

package resourcestream

import (
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	deploymentpkg "github.com/luxury-yacht/app/backend/resources/deployment"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
)

// podGVR is the pod kind's GVR, the key the pod reflector's store is registered under.
var podGVR = schema.GroupVersionResource{Group: podres.Identity.Group, Version: podres.Identity.Version, Resource: podres.Identity.Resource}

// podBundleRewriter rewrites stored pod bundles by owner key.
// *ingest.IngestManager satisfies it.
type podBundleRewriter interface {
	RewriteBundlesByIndex(
		gvr schema.GroupVersionResource,
		indexName string,
		values []string,
		rewrite func(ingest.Bundle) (ingest.Bundle, bool),
	) []ingest.Bundle
}

// registerOwnerHeals wires the ReplicaSet and Job owner heals. Both kinds are
// ingest kinds, so each heal is an ordered async sink on its store: the heal
// rewrites the Pod store, which a sink must not touch under its own store lock.
func (m *Manager) registerOwnerHeals(ingestManager *ingest.IngestManager) {
	if ingestManager == nil {
		return
	}
	m.replicaSetPodOwnerHealSink = m.addOwnerHealSink(ingestManager, snapshot.ReplicaSetGVR, replicaSetPodOwnerHealBundleSink{manager: m})
	m.jobPodOwnerHealSink = m.addOwnerHealSink(ingestManager, snapshot.JobGVR, jobPodOwnerHealBundleSink{manager: m})
}

func (m *Manager) addOwnerHealSink(ingestManager *ingest.IngestManager, gvr schema.GroupVersionResource, heal ingest.BundleSink) *ingest.AsyncBundleSink {
	if !m.canListWatch(gvr.Group, gvr.Resource) {
		return nil
	}
	sink := ingest.NewAsyncBundleSink(heal)
	if !ingestManager.AddBundleSink(gvr, sink) {
		sink.Stop()
		return nil
	}
	return sink
}

// replicaSetPodOwnerHealBundleSink re-resolves stored pod bundles whose
// ReplicaSet->Deployment owner could not be resolved when they were projected:
// a Pod projected before its ReplicaSet arrived carries the ReplicaSet as its
// collapsed owner, so the Deployment's pods query would miss it. Owned
// reflectors never resync, so the ReplicaSet's arrival must repair it.
type replicaSetPodOwnerHealBundleSink struct {
	manager *Manager
}

func (s replicaSetPodOwnerHealBundleSink) UpsertBundle(bundle ingest.Bundle) {
	owner, ok := bundle.Aggregate.(snapshot.ReplicaSetOwner)
	if !ok || s.manager == nil || s.manager.podIngest == nil {
		return
	}
	controller := owner.Controller
	if controller.Controller == nil || !*controller.Controller || controller.Kind != deploymentpkg.Identity.Kind || controller.Name == "" {
		// A standalone ReplicaSet's pods correctly keep the ReplicaSet owner.
		return
	}
	s.manager.podIngest.RewriteBundlesByIndex(
		podGVR,
		snapshot.PodOwnerKeyIndexName,
		snapshot.PodOwnerHealIndexValues(owner.Namespace, owner.Name, controller.Name),
		func(podBundle ingest.Bundle) (ingest.Bundle, bool) {
			return snapshot.HealPodBundleReplicaSetOwner(podBundle, owner.Namespace, owner.Name, controller.Name)
		},
	)
}

func (s replicaSetPodOwnerHealBundleSink) DeleteBundle(ingest.Bundle) {
	// A deleted ReplicaSet cascades to its pods, whose own deletes clean every
	// scope; an orphaned pod's owner-ref removal arrives as a pod update.
}

// jobPodOwnerHealBundleSink closes the startup race where the Pod reflector
// projects a Job-owned Pod before the Job reflector has exposed its CronJob
// controller. Job arrival rewrites the affected Pod bundles through their
// owner-key index.
type jobPodOwnerHealBundleSink struct {
	manager *Manager
}

func (s jobPodOwnerHealBundleSink) UpsertBundle(bundle ingest.Bundle) {
	owner, ok := bundle.Aggregate.(snapshot.JobControllerOwner)
	if !ok || s.manager == nil || s.manager.podIngest == nil || owner.Controller.Kind == "" || owner.Controller.Name == "" {
		return
	}
	s.manager.podIngest.RewriteBundlesByIndex(
		podGVR,
		snapshot.PodOwnerKeyIndexName,
		[]string{snapshot.WorkloadOwnerKey(owner.Job.Kind, owner.Job.Namespace, owner.Job.Name)},
		func(podBundle ingest.Bundle) (ingest.Bundle, bool) {
			return snapshot.HealPodBundleJobOwner(podBundle, owner)
		},
	)
}

func (s jobPodOwnerHealBundleSink) DeleteBundle(ingest.Bundle) {
	// Deletion requires no owner-healing rewrite because the pod row is removed.
}
