/*
 * backend/refresh/snapshot/pod_owner_heal.go
 *
 * Heals a projected pod bundle whose ReplicaSet->Deployment owner could not be
 * resolved at projection time. The pod projector resolves the owner through the
 * shared factory's ReplicaSet lister (pod_ingest_projector.go), but the pod
 * reflector starts before the factory (ingest_hub.go), so pods projected during
 * the connect window can land with OwnerKind=ReplicaSet. Owned reflectors never
 * resync, so without this heal those rows would keep the unresolved owner until
 * the pod's next watch event — leaving the Deployment's workload-scoped pods
 * query empty and its doorbell silent. The resource-stream manager applies the
 * heal from the ReplicaSet informer's event handler via
 * ProjectingStore.RewriteBundlesByIndex.
 *
 * The rewrite mirrors, field for field, what a fresh projection with a synced
 * lister produces: the Table half's owner triple (resolvePodOwner) and the
 * Aggregate half's WorkloadKind (workloadKindForPod). OwnerKey and the bundle
 * Indexes use the lister-independent name-suffix collapse, so they are already
 * correct and stay untouched. Equivalence with a fresh projection is pinned by
 * pod_owner_heal_test.go.
 */

package snapshot

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	deploymentpkg "github.com/luxury-yacht/app/backend/resources/deployment"
	replicasetpkg "github.com/luxury-yacht/app/backend/resources/replicaset"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// PodOwnerKeyIndexName is the pod bundle secondary index keyed by the row's
// owner-workload key (podAggregateBundleIndexes), exported so the resource-stream
// manager can address the pods needing an owner heal without a store scan.
const PodOwnerKeyIndexName = podOwnerKeyIndexName

// PodOwnerHealIndexValues returns the owner-key index values under which a
// ReplicaSet's pods may be stored. The projector's OwnerKey applies the
// name-suffix collapse (ownerKeyForPod): an RS name with a trimmable suffix
// indexes under the Deployment key, one without (no '-') under the ReplicaSet
// fallback key — so the heal looks up both.
func PodOwnerHealIndexValues(namespace, rsName, deploymentName string) []string {
	return []string{
		WorkloadOwnerKey(deploymentpkg.Identity.Kind, namespace, deploymentName),
		WorkloadOwnerKey(replicasetpkg.Identity.Kind, namespace, rsName),
	}
}

// HealPodBundleReplicaSetOwner rewrites a stored pod bundle whose owner is the
// still-unresolved ReplicaSet namespace/rsName, collapsing it to deploymentName
// exactly as projection with a synced lister would: the Table half's owner
// triple becomes Deployment/deploymentName/apps-v1 (resolvePodOwner) and the
// Aggregate half's WorkloadKind becomes Deployment (workloadKindForPod). It
// declines (returns the bundle unchanged, false) when the bundle is not a pod
// row owned by that ReplicaSet — including already-resolved rows, which makes
// the heal idempotent.
func HealPodBundleReplicaSetOwner(
	bundle ingest.Bundle,
	namespace, rsName, deploymentName string,
) (ingest.Bundle, bool) {
	table, ok := bundle.Table.(PodSummary)
	if !ok {
		return bundle, false
	}
	if table.Namespace != namespace ||
		table.OwnerKind != replicasetpkg.Identity.Kind ||
		table.OwnerName != rsName {
		return bundle, false
	}

	table.OwnerKind = deploymentpkg.Identity.Kind
	table.OwnerName = deploymentName
	table.OwnerAPIVersion = deploymentpkg.Identity.Group + "/" + deploymentpkg.Identity.Version
	bundle.Table = table

	if aggregate, ok := bundle.Aggregate.(streamrows.PodAggregate); ok {
		aggregate.WorkloadKind = deploymentpkg.Identity.Kind
		aggregate.OwnerKey = WorkloadOwnerKey(deploymentpkg.Identity.Kind, namespace, deploymentName)
		bundle.Aggregate = aggregate
		bundle.Indexes = podAggregateBundleIndexes(aggregate)
	}
	return bundle, true
}

// HealPodBundleJobOwner rewrites a pod projected before its owning Job was
// available, replacing the resolved owner with the Job's actual CronJob parent.
// The direct Job identity remains intact so both Job and CronJob scopes match.
func HealPodBundleJobOwner(bundle ingest.Bundle, owner JobControllerOwner) (ingest.Bundle, bool) {
	if !completeAttentionRef(owner.Job) || !completeAttentionRef(owner.Controller) {
		return bundle, false
	}
	table, ok := bundle.Table.(PodSummary)
	if !ok || table.ClusterID != owner.Job.ClusterID || table.Namespace != owner.Job.Namespace ||
		table.DirectOwnerKind != owner.Job.Kind || table.DirectOwnerName != owner.Job.Name {
		return bundle, false
	}
	controllerAPIVersion := schema.GroupVersion{Group: owner.Controller.Group, Version: owner.Controller.Version}.String()
	if table.OwnerAPIVersion == controllerAPIVersion && table.OwnerKind == owner.Controller.Kind && table.OwnerName == owner.Controller.Name {
		return bundle, false
	}

	table.OwnerAPIVersion = controllerAPIVersion
	table.OwnerKind = owner.Controller.Kind
	table.OwnerName = owner.Controller.Name
	bundle.Table = table
	return bundle, true
}
