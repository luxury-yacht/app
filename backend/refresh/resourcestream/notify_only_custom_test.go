package resourcestream

import (
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// The custom resource-stream domains are catalog-backed in production (the Custom
// tabs render the catalog customOnly query, not these resource-stream rows), so
// their streamed rows are legacy/unused. Like every streamed table they ship the
// change signal without the Row, removing the last resource-stream-table live-row
// consumers so the live-row path can be deleted (Phase 1).
func TestManagerNewObjectRowUpdateOmitsRowsForNotifyOnlyCustomDomains(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	object := &metav1.ObjectMeta{
		Name:            "widget",
		Namespace:       "default",
		UID:             "widget-uid",
		ResourceVersion: "11",
	}
	row := map[string]string{"name": "widget"}

	for _, domain := range []string{domainNamespaceCustom, domainClusterCustom} {
		ref := manager.resourceRefForObject(object, "example.com", "v1", "Widget", "widgets")
		for _, updateType := range []MessageType{MessageTypeAdded, MessageTypeModified} {
			update := manager.newObjectRowUpdate(updateType, domain, object, ref, row)
			require.Nilf(t, update.Row, "%s is query-backed; must omit Row for %s", domain, updateType)
		}
	}
}
