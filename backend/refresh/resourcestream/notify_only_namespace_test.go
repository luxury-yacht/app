package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// The namespace resource tables (config/rbac/network/quotas/storage/autoscaling) are
// query-backed (their NsView* components render the backend /query page), so the live
// stream ships only the change signal, not the projected Row — the notify-only
// treatment the cluster tables and pods/nodes/workloads already use. Completing Phase 1
// means these flip too; namespace-custom (catalog-backed) and namespace-helm
// (complete-resync) stay row-bearing.
func TestManagerNewObjectRowUpdateOmitsRowsForNotifyOnlyNamespaceDomains(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	object := &metav1.ObjectMeta{
		Name:            "res",
		Namespace:       "default",
		UID:             "res-uid",
		ResourceVersion: "9",
	}
	row := map[string]string{"name": "res"}

	domains := []string{
		domainNamespaceConfig,
		domainNamespaceRBAC,
		domainNamespaceNetwork,
		domainNamespaceQuotas,
		domainNamespaceStorage,
		domainNamespaceAutoscaling,
	}
	for _, domain := range domains {
		ref := manager.resourceRefForObject(object, "", "v1", "Resource", "resources")
		for _, updateType := range []MessageType{MessageTypeAdded, MessageTypeModified} {
			update := manager.newObjectRowUpdate(updateType, domain, object, ref, row)
			require.Nilf(t, update.Row, "%s is notify-only; must omit Row for %s", domain, updateType)
		}
	}
}
