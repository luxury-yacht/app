package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// cluster-config tables are query-backed (ClusterViewConfig renders the backend
// /query page via useQueryBackedClusterResourceGridTable), so the live stream only
// needs to ship the change signal, not the projected row — like every other streamed
// table. cluster-config must omit Row on add/modify while identity (Ref) and
// ResourceVersion still travel, so shadow-key drift detection and the query-backed
// refetch trigger keep working.
func TestManagerNewObjectRowUpdateOmitsRowsForClusterConfig(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	object := &metav1.ObjectMeta{
		Name:            "cm",
		Namespace:       "default",
		UID:             "cm-uid",
		ResourceVersion: "42",
	}
	row := map[string]string{"name": "cm"}
	ref := manager.resourceRefForObject(object, "", "v1", "ConfigMap", "configmaps")

	for _, updateType := range []MessageType{MessageTypeAdded, MessageTypeModified} {
		update := manager.newObjectRowUpdate(updateType, domainClusterConfig, object, ref, row)
		require.Nilf(t, update.Row, "cluster-config is query-backed; must omit Row for %s", updateType)
		require.Equal(t, "42", update.ResourceVersion)
		require.Equal(t, ref, *update.Ref)
	}
}

// The remaining query-backed cluster domains follow the same pattern as
// cluster-config: their tables render the backend /query page, so the stream omits
// the projected Row and ships only the change signal.
func TestManagerNewObjectRowUpdateOmitsRowsForNotifyOnlyClusterDomains(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	object := &metav1.ObjectMeta{
		Name:            "res",
		UID:             "res-uid",
		ResourceVersion: "7",
	}
	row := map[string]string{"name": "res"}

	for _, domain := range []string{domainClusterRBAC, domainClusterStorage, domainClusterCRDs} {
		ref := manager.resourceRefForObject(object, "", "v1", "Resource", "resources")
		for _, updateType := range []MessageType{MessageTypeAdded, MessageTypeModified} {
			update := manager.newObjectRowUpdate(updateType, domain, object, ref, row)
			require.Nilf(t, update.Row, "%s is query-backed; must omit Row for %s", domain, updateType)
		}
	}
}
