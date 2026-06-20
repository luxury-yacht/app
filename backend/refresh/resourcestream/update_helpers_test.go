package resourcestream

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func TestManagerNewObjectUpdateCopiesClusterAndObjectMetadata(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "cfg",
			Namespace:       "default",
			UID:             "cfg-uid",
			ResourceVersion: "42",
		},
	}

	ref := manager.resourceRefForObject(configMap, "", "v1", "ConfigMap", "configmaps")
	update := manager.newObjectUpdate(MessageTypeModified, domainNamespaceConfig, configMap, ref)

	require.Equal(t, MessageTypeModified, update.Type)
	require.Equal(t, domainNamespaceConfig, update.Domain)
	require.Equal(t, "cluster-id", update.ClusterID)
	require.Equal(t, "cluster-name", update.ClusterName)
	require.Equal(t, "42", update.ResourceVersion)
	require.Equal(t, "cfg-uid", update.Ref.UID)
	require.Equal(t, "cfg", update.Ref.Name)
	require.Equal(t, "default", update.Ref.Namespace)
	require.Equal(t, "ConfigMap", update.Ref.Kind)
	require.Equal(t, "", update.Ref.Group)
	require.Equal(t, "v1", update.Ref.Version)
	require.Equal(t, ref, *update.Ref)
	require.Nil(t, update.Row)
}

func TestManagerResourceRefForObjectBuildsValidatedIdentity(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cfg",
			Namespace: "default",
			UID:       "cfg-uid",
		},
	}

	ref := manager.resourceRefForObject(configMap, "", "v1", "ConfigMap", "configmaps")

	require.NoError(t, resourcemodel.ValidateResourceRef(ref))
	require.Equal(t, "cluster-id", ref.ClusterID)
	require.Equal(t, "configmaps", ref.Resource)
}

func TestManagerResourceRefForObjectValidationRejectsIncompleteIdentity(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	configMap := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "cfg"}}

	require.Error(t, resourcemodel.ValidateResourceRef(manager.resourceRefForObject(configMap, "", "", "ConfigMap", "configmaps")))
	require.Error(t, resourcemodel.ValidateResourceRef(manager.resourceRefForObject(configMap, "", "v1", "Deployment", "deployments")))
}

func TestManagerNewObjectRowUpdateOmitsRowsForDeletes(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "secret",
			Namespace:       "default",
			UID:             "secret-uid",
			ResourceVersion: "9",
		},
	}
	row := map[string]string{"name": "secret"}

	ref := manager.resourceRefForObject(secret, "", "v1", "Secret", "secrets")
	added := manager.newObjectRowUpdate(MessageTypeAdded, domainNamespaceConfig, secret, ref, row)
	require.Equal(t, row, added.Row)

	deleted := manager.newObjectRowUpdate(MessageTypeDeleted, domainNamespaceConfig, secret, ref, row)
	require.Nil(t, deleted.Row)
	require.Equal(t, "secret", deleted.Ref.Name)
	require.Equal(t, "default", deleted.Ref.Namespace)
	require.Equal(t, ref, *deleted.Ref)
}

func TestManagerNewObjectRowUpdateOmitsRowsForNotifyOnlyDomains(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	object := &metav1.ObjectMeta{
		Name:            "web",
		Namespace:       "default",
		UID:             "web-uid",
		ResourceVersion: "77",
	}
	row := map[string]string{"name": "web"}
	ref := manager.resourceRefForObject(object, "apps", "v1", "Deployment", "deployments")

	// A notify-only domain ships change notifications without the projected row:
	// even ADDED/MODIFIED omit Row, while identity (Ref) and ResourceVersion still
	// travel so drift detection and the query-backed refetch trigger keep working.
	for _, updateType := range []MessageType{MessageTypeAdded, MessageTypeModified} {
		update := manager.newObjectRowUpdate(updateType, domainWorkloads, object, ref, row)
		require.Nilf(t, update.Row, "notify-only domain must omit Row for %s", updateType)
		require.Equal(t, "77", update.ResourceVersion)
		require.Equal(t, ref, *update.Ref)
	}

	// A non-notify-only domain still carries the row on add/modify.
	configUpdate := manager.newObjectRowUpdate(MessageTypeAdded, domainNamespaceConfig, object, ref, row)
	require.Equal(t, row, configUpdate.Row)
}

func TestManagerNewObjectRowUpdateCarriesMetadataFromResourceRef(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "cluster-id", ClusterName: "cluster-name"},
	}
	tests := []struct {
		name      string
		domain    string
		kind      string
		namespace string
		group     string
		version   string
		resource  string
	}{
		{name: "configmaps", domain: domainNamespaceConfig, kind: "ConfigMap", namespace: "default", version: "v1", resource: "configmaps"},
		{name: "endpoint slices", domain: domainNamespaceNetwork, kind: "EndpointSlice", namespace: "default", group: "discovery.k8s.io", version: "v1", resource: "endpointslices"},
		{name: "cluster roles", domain: domainClusterRBAC, kind: "ClusterRole", group: "rbac.authorization.k8s.io", version: "v1", resource: "clusterroles"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			object := &metav1.ObjectMeta{
				Name:            "resource-name",
				Namespace:       tt.namespace,
				UID:             "resource-uid",
				ResourceVersion: "123",
			}
			row := map[string]string{
				"clusterId": "cluster-id",
				"kind":      tt.kind,
				"name":      "resource-name",
			}
			if tt.namespace != "" {
				row["namespace"] = tt.namespace
			}

			ref := manager.resourceRefForObject(object, tt.group, tt.version, tt.kind, tt.resource)
			update := manager.newObjectRowUpdate(MessageTypeAdded, tt.domain, object, ref, row)

			require.Equal(t, tt.domain, update.Domain)
			require.Equal(t, "cluster-id", update.ClusterID)
			require.Equal(t, "cluster-name", update.ClusterName)
			require.Equal(t, "123", update.ResourceVersion)
			require.Equal(t, "resource-uid", update.Ref.UID)
			require.Equal(t, "resource-name", update.Ref.Name)
			require.Equal(t, tt.namespace, update.Ref.Namespace)
			require.Equal(t, tt.kind, update.Ref.Kind)
			require.Equal(t, tt.group, update.Ref.Group)
			require.Equal(t, tt.version, update.Ref.Version)
			require.Equal(t, tt.resource, update.Ref.Resource)
			require.Equal(t, ref, *update.Ref)
			require.Equal(t, row, update.Row)
		})
	}
}
