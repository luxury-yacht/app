/*
 * backend/refresh/resourcestream/owner_heals.go
 *
 * Repairs stored pod bundles whose owner could not be resolved when they were
 * projected. The rewrite fans through the pod store's sinks like a reflector
 * update, so the pods table store publishes the healed row's old and new scopes.
 */

package resourcestream

import (
	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh/informer"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	deploymentpkg "github.com/luxury-yacht/app/backend/resources/deployment"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
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

// registerOwnerHeals wires the ReplicaSet and Job owner heals. ReplicaSet stays a
// typed shared informer because the pod projector resolves owners through its
// lister; Job is an ingest kind, so its heal is a bundle sink.
func (m *Manager) registerOwnerHeals(factory *informer.Factory, ingestManager *ingest.IngestManager) {
	if ingestManager == nil {
		return
	}
	if m.canListWatch("apps", "replicasets") {
		rsInformer := factory.SharedInformerFactory().Apps().V1().ReplicaSets()
		m.addRelatedResourceEventHandler(rsInformer.Informer(), (*Manager).handleReplicaSetEvent)
	}
	if m.canListWatch(jobres.Identity.Group, jobres.Identity.Resource) {
		m.jobPodOwnerHealSink = ingest.NewAsyncBundleSink(jobPodOwnerHealBundleSink{manager: m})
		if !ingestManager.AddBundleSink(snapshot.JobGVR, m.jobPodOwnerHealSink) {
			m.jobPodOwnerHealSink.Stop()
			m.jobPodOwnerHealSink = nil
		}
	}
}

func (m *Manager) handleReplicaSetEvent(oldObj interface{}, newObj interface{}, updateType MessageType) {
	switch updateType {
	case MessageTypeAdded, MessageTypeModified:
		m.healPodsForReplicaSet(replicaSetFromObject(newObj))
	case MessageTypeDeleted:
		// Nothing to heal: a deleted RS cascades to its pods, whose own delete
		// events clean every scope; an orphaned pod's owner-ref removal arrives
		// as a pod update and re-projects its row.
	}
}

// healPodsForReplicaSet re-resolves stored pod bundles whose ReplicaSet->
// Deployment owner could not be resolved when they were projected. The pod
// projector reads the shared factory's RS lister, but the owned pod reflector
// starts BEFORE the factory (ingest_hub.go), so pods projected in that window
// carry the unresolved ReplicaSet as their collapsed owner — the Deployment's
// workload-scoped pods query then serves nothing, and owned reflectors never
// resync to repair it. Healing on the RS informer's events closes the race.
func (m *Manager) healPodsForReplicaSet(rs *appsv1.ReplicaSet) {
	if rs == nil || m.podIngest == nil {
		return
	}
	deployment := replicaSetDeploymentOwnerName(rs)
	if deployment == "" {
		// A standalone RS's pods correctly keep the ReplicaSet owner.
		return
	}
	m.podIngest.RewriteBundlesByIndex(
		podGVR,
		snapshot.PodOwnerKeyIndexName,
		snapshot.PodOwnerHealIndexValues(rs.Namespace, rs.Name, deployment),
		func(bundle ingest.Bundle) (ingest.Bundle, bool) {
			return snapshot.HealPodBundleReplicaSetOwner(bundle, rs.Namespace, rs.Name, deployment)
		},
	)
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

// replicaSetFromObject decodes a ReplicaSet informer payload, or returns nil.
func replicaSetFromObject(obj interface{}) *appsv1.ReplicaSet {
	typed, _ := objectAs[*appsv1.ReplicaSet](obj)
	return typed
}

func replicaSetDeploymentOwnerName(rs *appsv1.ReplicaSet) string {
	if rs == nil {
		return ""
	}
	for _, owner := range rs.OwnerReferences {
		if owner.Controller != nil && *owner.Controller && owner.Kind == deploymentpkg.Identity.Kind && owner.Name != "" {
			return owner.Name
		}
	}
	return ""
}
